// 一次性修复脚本：用当前的导入规则回补历史上被导坏的工作记录
// 默认 dry-run，加 --apply 参数才真正写入数据库
//
// 用法：
//   cd src
//   node scripts/repair-zero-quantity-worklogs.mjs            # 预览
//   node scripts/repair-zero-quantity-worklogs.mjs --apply    # 执行
//
// 修复对象：WorkLog.quantity = 0 且 rawText 非空
// 修复策略：
//   1. 把 rawText 按 \t 拆回原始单元格，重新跑当前的解析/拆分规则
//   2. 第一条原子记录就地 UPDATE 原 WorkLog（保留 id/project/staff）
//   3. 多出来的原子记录按原 WorkLog 复制一份（同 project/日期/人员），作为新 WorkLog
//   4. 修改过的项目统一调用 rebuildProjectProduction 重算产值

import { PrismaClient } from '@prisma/client';

const DRY_RUN = !process.argv.includes('--apply');

// ─────────────────────────── 解析工具（来自 src/lib/wpsParser.js 的纯函数拷贝） ───────────────────────────

const SIMPLE_QUANTITY_REGEX = /^(\d+(?:\.\d+)?)\s*([\u4e00-\u9fa5A-Za-z%]+)?$/u;
const QUANTITY_CANDIDATE_REGEX = /(\d+(?:\.\d+)?)(个构件|构件|点|组|根|栋|项|处|个|柱|梁|米|m²|㎡|m2|m)/gu;

function cleanCellValue(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function normalizeQuantityUnit(unit) {
    const rawUnit = cleanCellValue(unit);
    if (!rawUnit) return null;
    if (rawUnit === '构件' || rawUnit === '个构件') return '个构件';
    if (rawUnit === 'm²' || rawUnit === '㎡' || rawUnit === 'm2') return '㎡';
    if (rawUnit === 'm') return '米';
    return rawUnit;
}

function getQuantityUnitPriority(unit) {
    const normalizedUnit = normalizeQuantityUnit(unit);
    switch (normalizedUnit) {
    case '点': return 9;
    case '根': return 8;
    case '处': return 7;
    case '项': return 6;
    case '个构件': return 5;
    case '米':
    case '㎡': return 4;
    case '柱':
    case '梁':
    case '个': return 3;
    case '组': return 1;
    case '栋': return 0;
    default: return 2;
    }
}

function extractQuantityCandidates(quantityText) {
    const normalizedText = cleanCellValue(quantityText).replace(/\s+/gu, '');
    const candidates = [];
    let match;
    QUANTITY_CANDIDATE_REGEX.lastIndex = 0;
    while ((match = QUANTITY_CANDIDATE_REGEX.exec(normalizedText)) !== null) {
        candidates.push({
            quantity: Number.parseFloat(match[1]),
            unit: normalizeQuantityUnit(match[2]),
            index: match.index,
        });
    }
    return candidates;
}

function pickBestQuantityCandidate(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    return candidates
        .filter((candidate) => Number.isFinite(candidate.quantity))
        .sort((left, right) => {
            const priorityDiff = getQuantityUnitPriority(right.unit) - getQuantityUnitPriority(left.unit);
            if (priorityDiff !== 0) return priorityDiff;
            return left.index - right.index;
        })[0] || null;
}

function parseQuantityField(value) {
    const quantityText = cleanCellValue(value);
    if (!quantityText) return { quantity: 0, unit: null, quantityText: '' };
    const compact = quantityText.replace(/\s+/g, '');
    const simpleMatch = compact.match(SIMPLE_QUANTITY_REGEX);
    if (simpleMatch) {
        return {
            quantity: Number.parseFloat(simpleMatch[1]),
            unit: normalizeQuantityUnit(simpleMatch[2]) || null,
            quantityText,
        };
    }
    if (/^\d+(?:\.\d+)?$/.test(compact)) {
        return { quantity: Number.parseFloat(compact), unit: null, quantityText };
    }
    const bestCandidate = pickBestQuantityCandidate(extractQuantityCandidates(quantityText));
    if (bestCandidate) {
        return { quantity: bestCandidate.quantity, unit: bestCandidate.unit, quantityText };
    }
    return { quantity: 0, unit: null, quantityText };
}

function parseStaffNames(value) {
    return cleanCellValue(value)
        .split(/[、,，\s]+/u)
        .map((item) => item.replace(/[0-9\-+]/g, '').trim())
        .filter((item) => item.length >= 1 && item.length <= 10);
}

function composeRemarks(parts) {
    const extra = [];
    if (parts[5]) extra.push(parts[5]);
    if (parts[6]) extra.push(`停车费 ${parts[6]}`);
    if (parts[7]) extra.push(`联系人 ${parts[7]}`);
    return extra.join(' | ') || null;
}

function mergeRemarks(baseRemarks, extraNotes) {
    const values = [baseRemarks, extraNotes].map((item) => cleanCellValue(item)).filter(Boolean);
    return Array.from(new Set(values)).join(' | ') || null;
}

function createAtomicRow(baseRow, overrides = {}) {
    const quantity = overrides.quantity === null || overrides.quantity === undefined
        ? baseRow.quantity
        : Number.parseFloat(overrides.quantity);
    const unit = cleanCellValue(overrides.unit || baseRow.unit) || null;
    const testContent = cleanCellValue(overrides.testContent || baseRow.testContent) || baseRow.testContent;
    return {
        ...baseRow,
        testContent,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        unit,
        remarks: mergeRemarks(baseRow.remarks, overrides.notes),
    };
}

function extractObservationContext(text) {
    const rawText = cleanCellValue(text);
    if (!rawText) return '';
    const match = rawText.match(/^(.*?)(沉降|竖向|水平|倾斜|位移|观测|布点)/u);
    return match ? match[1].replace(/[、/]+$/u, '').trim() : '';
}

function normalizeObservationNotes(label, keyword) {
    return cleanCellValue(label)
        .replace(keyword, '')
        .replace(/观测|布点|位移|监测|测/gu, '')
        .replace(/[、/]+$/u, '')
        .trim();
}

function resolveObservationSegment(row, label) {
    const baseText = cleanCellValue(row.testContent);
    const normalizedLabel = cleanCellValue(label).replace(/[：:]/gu, '');
    const baseContext = extractObservationContext(baseText);
    if (/布/u.test(normalizedLabel)) {
        return {
            testContent: baseText.includes('沉降') ? '沉降布点' : `${baseText || '观测'}布点`,
            notes: baseContext || normalizeObservationNotes(normalizedLabel, /布/u),
        };
    }
    if (/水平/u.test(normalizedLabel)) {
        return {
            testContent: '水平位移监测',
            notes: normalizeObservationNotes(normalizedLabel, /水平/u) || baseContext,
        };
    }
    if (/竖向/u.test(normalizedLabel)) {
        return {
            testContent: '竖向位移监测',
            notes: normalizeObservationNotes(normalizedLabel, /竖向/u) || baseContext,
        };
    }
    if (/倾斜/u.test(normalizedLabel)) {
        return {
            testContent: '倾斜观测',
            notes: normalizeObservationNotes(normalizedLabel, /倾斜/u) || baseContext,
        };
    }
    if (/沉降/u.test(normalizedLabel)) {
        return {
            testContent: '沉降观测',
            notes: normalizeObservationNotes(normalizedLabel, /沉降/u) || baseContext,
        };
    }
    if (/测|观测/u.test(normalizedLabel)) {
        return {
            testContent: baseText.includes('沉降') ? '沉降观测' : (baseText || '观测'),
            notes: baseContext || normalizeObservationNotes(normalizedLabel, /测|观测/gu),
        };
    }
    return { testContent: baseText, notes: baseContext };
}

function expandDisplacementRow(row) {
    if (!/竖向位移|水平位移/u.test(row.quantityText || '')) return null;
    const lines = row.quantityText.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
    const expanded = [];
    lines.forEach((line) => {
        const siteName = line.split(/[：:]/u)[0]?.trim() || '';
        const verticalMatch = line.match(/竖向位移(?:点)?\s*(\d+(?:\.\d+)?)\s*个?/u);
        const horizontalMatch = line.match(/水平位移(?:点)?\s*(\d+(?:\.\d+)?)\s*个?/u);
        if (verticalMatch) {
            expanded.push(createAtomicRow(row, {
                testContent: row.testContent.includes('沉降') ? '沉降观测' : '竖向位移监测',
                quantity: verticalMatch[1],
                unit: '点',
                notes: siteName,
            }));
        }
        if (horizontalMatch) {
            expanded.push(createAtomicRow(row, {
                testContent: row.testContent.includes('倾斜') ? '倾斜观测' : '水平位移监测',
                quantity: horizontalMatch[1],
                unit: '点',
                notes: siteName,
            }));
        }
    });
    return expanded.length > 0 ? expanded : null;
}

function expandObservationBundleRow(row) {
    const quantityText = cleanCellValue(row.quantityText);
    const baseText = cleanCellValue(row.testContent);
    if (!quantityText) return null;
    if (!/沉降|观测|布点|布\d|测\d|竖向|水平|倾斜|位移/u.test(`${baseText} ${quantityText}`)) return null;
    const normalizedText = quantityText.replace(/[，,；;]/gu, '、').replace(/\s+/gu, '');
    const segmentRegex = /([^0-9、]{0,16}?)(\d+(?:\.\d+)?)(点|组|根|项|处|个构件|构件|个)/gu;
    const segments = [];
    let match;
    while ((match = segmentRegex.exec(normalizedText)) !== null) {
        segments.push({
            label: cleanCellValue(match[1]),
            quantity: match[2],
            unit: normalizeQuantityUnit(match[3]) || match[3],
        });
    }
    if (segments.length === 0) return null;
    if (segments.length === 1 && !/布|测|沉降|竖向|水平|倾斜|位移/u.test(segments[0].label)) return null;
    return segments.map((segment) => {
        const resolved = resolveObservationSegment(row, segment.label);
        return createAtomicRow(row, {
            testContent: resolved.testContent,
            quantity: segment.quantity,
            unit: segment.unit,
            notes: resolved.notes,
        });
    });
}

function normalizeBundleItemName(name, fallbackName) {
    const rawName = cleanCellValue(name || fallbackName);
    if (!rawName) return fallbackName;
    if (rawName.includes('砖回弹')) return '砖回弹';
    if (rawName.includes('回弹')) return '回弹';
    if (rawName.includes('砂浆贯入')) return '砂浆贯入';
    if (rawName.includes('超声')) return '超声法';
    if (rawName.includes('净高')) return '净高';
    if (rawName.includes('层高')) return '净高';
    if (rawName.includes('板厚')) return '板厚';
    if (rawName.includes('保护层')) return '保护层';
    if (rawName.includes('植筋')) return '植筋拉拔';
    if (rawName.includes('防雷')) return '防雷检测';
    return rawName;
}

function splitCombinedBundleNames(name) {
    const rawName = cleanCellValue(name);
    if (!rawName) return [];
    if (/板厚.*层高|层高.*板厚/u.test(rawName)) return ['板厚', '层高'];
    return [rawName];
}

function getBundleUnit(itemName, fallbackUnit) {
    const normalizedName = normalizeBundleItemName(itemName, itemName);
    const normalizedUnit = normalizeQuantityUnit(fallbackUnit) || fallbackUnit;
    if (normalizedName === '保护层') return '处';
    if (normalizedName === '板厚' || normalizedName === '净高') return '点';
    if (normalizedUnit === '构件' || normalizedUnit === '个构件') return '个构件';
    return normalizedUnit;
}

function appendExpandedBundleItems(expanded, row, name, quantity, unit, notes = '') {
    const itemNames = splitCombinedBundleNames(name);
    if (itemNames.length === 0) return;
    itemNames.forEach((itemName) => {
        const normalizedName = normalizeBundleItemName(itemName, row.testContent);
        expanded.push(createAtomicRow(row, {
            testContent: normalizedName,
            quantity,
            unit: getBundleUnit(normalizedName, unit),
            notes,
        }));
    });
}

function expandMethodBundleRow(row) {
    const quantityText = cleanCellValue(row.quantityText);
    if (!quantityText) return null;
    const normalizedText = quantityText.replace(/[，,；;]/gu, '、').replace(/\s+/gu, '');
    const segments = normalizedText.split('、').filter(Boolean);
    if (segments.length === 0) return null;
    const expanded = [];
    segments.forEach((segment) => {
        const multiplierMatch = segment.match(/^(.+?)[*×xX](\d+(?:\.\d+)?)$/u);
        if (multiplierMatch) {
            appendExpandedBundleItems(expanded, row, multiplierMatch[1], multiplierMatch[2], '处');
            return;
        }
        const namedBeamColumnMatch = segment.match(/^([^\d]+?)(\d+(?:\.\d+)?)柱(\d+(?:\.\d+)?)梁$/u);
        if (namedBeamColumnMatch) {
            appendExpandedBundleItems(expanded, row, namedBeamColumnMatch[1], namedBeamColumnMatch[2], '柱');
            appendExpandedBundleItems(expanded, row, namedBeamColumnMatch[1], namedBeamColumnMatch[3], '梁');
            return;
        }
        const beamColumnWithNameMatch = segment.match(/^(\d+(?:\.\d+)?)柱(\d+(?:\.\d+)?)梁[（(]([^）)]+)[）)]$/u);
        if (beamColumnWithNameMatch) {
            appendExpandedBundleItems(expanded, row, beamColumnWithNameMatch[3], beamColumnWithNameMatch[1], '柱');
            appendExpandedBundleItems(expanded, row, beamColumnWithNameMatch[3], beamColumnWithNameMatch[2], '梁');
            return;
        }
        const leadingQuantityMatch = segment.match(/^(\d+(?:\.\d+)?)(净高|板厚|保护层)$/u);
        if (leadingQuantityMatch) {
            appendExpandedBundleItems(expanded, row, leadingQuantityMatch[2], leadingQuantityMatch[1], leadingQuantityMatch[2] === '保护层' ? '处' : '点');
            return;
        }
        const bareStructureMatch = segment.match(/^(\d+(?:\.\d+)?)(?:个)?构件(?:[（(][^）)]*[）)])?$/u);
        if (bareStructureMatch) {
            appendExpandedBundleItems(expanded, row, row.testContent, bareStructureMatch[1], '个构件');
            return;
        }
        const namedEachMatch = segment.match(/^(.+?)各(\d+(?:\.\d+)?)(个构件|构件|点|项|处|个|组|根)$/u);
        if (namedEachMatch) {
            appendExpandedBundleItems(expanded, row, namedEachMatch[1], namedEachMatch[2], namedEachMatch[3]);
            return;
        }
        const colonItemMatch = segment.match(/^(.+?)[：:](?:\d+(?:\.\d+)?圆)?(\d+(?:\.\d+)?)(根|点|项|处|个构件|构件|个|组)$/u);
        if (colonItemMatch) {
            appendExpandedBundleItems(expanded, row, colonItemMatch[1], colonItemMatch[2], colonItemMatch[3]);
            return;
        }
        const genericMatch = segment.match(/^(.+?)(\d+(?:\.\d+)?)(个构件|构件|柱|梁|点|项|处|个|组|根)(?:[（(][^）)]*[）)])?$/u);
        if (genericMatch) {
            appendExpandedBundleItems(expanded, row, genericMatch[1], genericMatch[2], genericMatch[3]);
        }
    });
    return expanded.length > 1 ? expanded : null;
}

// 把存储于数据库的 rawText 还原成 normalizeRows 吐出来的"一行"结构
function parseRawTextToBaseRow(worklog) {
    const raw = worklog.rawText || '';
    const parts = raw.split('\t').map(cleanCellValue);
    // parts 顺序：日期 / 项目 / 检测内容 / 数量文本 / 人员 / 备注 / 停车费 / 联系人
    const quantityInfo = parseQuantityField(parts[3]);
    return {
        workDate: worklog.workDate,          // 直接用 DB 里的日期（Date 对象）
        projectName: parts[1] || '',         // 仅用于 fallback
        testContent: parts[2] || worklog.testContent || '',
        quantity: quantityInfo.quantity,
        unit: quantityInfo.unit,
        quantityText: quantityInfo.quantityText,
        staffNames: parseStaffNames(parts[4]),
        remarks: composeRemarks(parts),
        raw,
    };
}

function expandBaseRow(baseRow) {
    const disp = expandDisplacementRow(baseRow);
    if (disp?.length) return disp;
    const obs = expandObservationBundleRow(baseRow);
    if (obs?.length) return obs;
    const bundle = expandMethodBundleRow(baseRow);
    if (bundle?.length) return bundle;
    return [baseRow];
}

// ─────────────────────────── 主流程 ───────────────────────────

const prisma = new PrismaClient();

function fmt(row) {
    return `q=${row.quantity}${row.unit ? row.unit : ''} | ${row.testContent}${row.remarks ? ` | 备注:${row.remarks}` : ''}`;
}

async function main() {
    console.log(`=== 修复 quantity=0 的工作记录 (${DRY_RUN ? 'DRY-RUN' : 'APPLY'}) ===\n`);

    const zeros = await prisma.workLog.findMany({
        where: { quantity: 0, rawText: { not: null } },
        include: {
            project: { select: { id: true, name: true } },
            staffMembers: { include: { staff: true } },
        },
        orderBy: { workDate: 'asc' },
    });

    console.log(`候选: ${zeros.length} 条\n`);

    let willUpdate = 0;
    let willCreate = 0;
    let stillZero = 0;
    let unchanged = 0;
    const affectedProjectIds = new Set();
    const plans = [];

    for (const log of zeros) {
        const baseRow = parseRawTextToBaseRow(log);
        const atomics = expandBaseRow(baseRow);

        // 没拆、且数量仍然是 0 —— 说明当前规则也救不了这条，单独归类
        if (atomics.length === 1 && (atomics[0].quantity || 0) <= 0) {
            stillZero += 1;
            plans.push({
                log,
                atomics,
                action: 'still-zero',
            });
            continue;
        }

        // 拆成 1 条，但数量变成非 0 —— 就地更新
        if (atomics.length === 1) {
            willUpdate += 1;
            affectedProjectIds.add(log.projectId);
            plans.push({ log, atomics, action: 'update' });
            continue;
        }

        // 拆成多条 —— 第一条更新，其余 create
        willUpdate += 1;
        willCreate += atomics.length - 1;
        affectedProjectIds.add(log.projectId);
        plans.push({ log, atomics, action: 'update+create' });
    }

    unchanged = zeros.length - willUpdate - (willCreate ? 0 : 0) - stillZero;

    // 输出预览
    for (const plan of plans) {
        const log = plan.log;
        const headline = `#${log.id} [${log.workDate.toISOString().slice(0, 10)}] ${log.project?.name || '(无项目)'}`;
        console.log(headline);
        console.log(`  原: q=${log.quantity} | ${log.testContent}${log.remarks ? ` | 备注:${log.remarks}` : ''}`);
        plan.atomics.forEach((row, idx) => {
            const tag = plan.action === 'still-zero' ? '无改善' : (idx === 0 ? '更新' : '新增');
            console.log(`  → [${tag}] ${fmt(row)}`);
        });
        console.log('');
    }

    console.log('=== 摘要 ===');
    console.log(`候选:              ${zeros.length}`);
    console.log(`将更新原记录:      ${willUpdate}`);
    console.log(`将新增记录:        ${willCreate}`);
    console.log(`当前规则无法救:    ${stillZero}`);
    console.log(`影响项目数:        ${affectedProjectIds.size}`);
    console.log('');

    if (DRY_RUN) {
        console.log('（DRY-RUN，未写入数据库。确认后加 --apply 参数执行。）');
        await prisma.$disconnect();
        return;
    }

    // APPLY 阶段
    console.log('>>> 开始写入...');
    for (const plan of plans) {
        if (plan.action === 'still-zero') continue;
        const log = plan.log;
        const first = plan.atomics[0];

        // 第一条就地更新
        await prisma.workLog.update({
            where: { id: log.id },
            data: {
                testContent: first.testContent,
                quantity: Number.parseFloat(first.quantity) || 0,
                unit: first.unit || null,
                remarks: first.remarks || null,
            },
        });
        // 删掉旧的 ProductionValue（避免 project 重算时重复，rebuild 本身也会删但稳妥起见）
        await prisma.productionValue.deleteMany({ where: { workLogId: log.id } });

        // 其余条 create
        const staffIds = log.staffMembers.map((sm) => sm.staffId);
        for (let i = 1; i < plan.atomics.length; i += 1) {
            const extra = plan.atomics[i];
            await prisma.workLog.create({
                data: {
                    workDate: log.workDate,
                    projectId: log.projectId,
                    testContent: extra.testContent,
                    quantity: Number.parseFloat(extra.quantity) || 0,
                    unit: extra.unit || null,
                    rawText: `${log.rawText || ''}\n[auto-split from #${log.id}]`,
                    remarks: extra.remarks || null,
                    staffMembers: {
                        create: staffIds.map((staffId) => ({ staffId })),
                    },
                },
            });
        }
    }
    console.log(`<<< 工作记录写入完成：更新 ${willUpdate} 条，新增 ${willCreate} 条`);

    // 统一重算受影响项目的产值
    // 注意：rebuildProjectProduction 依赖 @/lib/... 路径，不能直接在这里 require
    // 所以这里只打印受影响的 projectIds，让用户/下一步调用 API 触发重算
    console.log('');
    console.log(`影响项目 ID（需要后续重算产值）: ${Array.from(affectedProjectIds).join(', ')}`);
    console.log('可以登录网站在每个项目上点"重算产值"，或让下一步脚本批量调 rebuildProjectProduction');

    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});
