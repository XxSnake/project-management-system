import * as XLSX from 'xlsx';

import { hasTaskProvider, requestTaskModel } from '@/lib/modelGateway';

const SIMPLE_QUANTITY_REGEX = /^(\d+(?:\.\d+)?)\s*([\u4e00-\u9fa5A-Za-z%]+)?$/u;
const QUANTITY_CANDIDATE_REGEX = /(\d+(?:\.\d+)?)(个构件|构件|点|组|根|栋|项|处|个|柱|梁|米|m²|㎡|m2|m)/gu;
const MODEL_BATCH_SIZE = 6;
const MAX_MODEL_ROWS_PER_IMPORT = 6;
const COMMON_ITEM_NAMES = [
    '轻型动力触探',
    '沉降观测',
    '倾斜观测',
    '砂浆贯入',
    '回弹',
    '砖回弹',
    '超声法',
    '净高',
    '板厚',
    '保护层',
    '接地电阻',
];

function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function cleanCellValue(value) {
    if (value === null || value === undefined) {
        return '';
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return formatDate(value);
    }

    return String(value).trim();
}

function parseDelimitedRows(rawText) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;

    for (let index = 0; index < rawText.length; index += 1) {
        const char = rawText[index];

        if (char === '"') {
            if (inQuotes && rawText[index + 1] === '"') {
                currentCell += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === '\t' && !inQuotes) {
            currentRow.push(currentCell);
            currentCell = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && rawText[index + 1] === '\n') {
                continue;
            }

            currentRow.push(currentCell);
            currentCell = '';
            if (currentRow.some((cell) => String(cell || '').trim() !== '')) {
                rows.push(currentRow);
            }
            currentRow = [];
            continue;
        }

        currentCell += char;
    }

    if (currentCell || currentRow.length > 0) {
        currentRow.push(currentCell);
        if (currentRow.some((cell) => String(cell || '').trim() !== '')) {
            rows.push(currentRow);
        }
    }

    return rows;
}

function isHeaderRow(parts) {
    const joined = parts.join('|');
    return joined.includes('日期') && joined.includes('项目') && (joined.includes('工作内容') || joined.includes('检测内容'));
}

function isTitleRow(parts) {
    return parts.length === 1 && /工作.*记录/u.test(parts[0]);
}

function parseDateValue(value) {
    const dateStr = cleanCellValue(value);
    if (!dateStr) {
        return null;
    }

    if (/^\d{5}$/.test(dateStr)) {
        const excelEpoch = new Date(1899, 11, 30);
        const targetDate = new Date(excelEpoch.getTime() + Number.parseInt(dateStr, 10) * 86400000);
        return formatDate(targetDate);
    }

    const datePatterns = [
        /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/,
        /^(\d{1,2})[\/\-.](\d{1,2})$/,
    ];

    for (const pattern of datePatterns) {
        const match = dateStr.match(pattern);
        if (!match) {
            continue;
        }

        if (match.length === 4) {
            return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
        }

        const currentYear = new Date().getFullYear();
        return `${currentYear}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    }

    const date = new Date(dateStr);
    if (!Number.isNaN(date.getTime())) {
        return formatDate(date);
    }

    return null;
}

function normalizeQuantityUnit(unit) {
    const rawUnit = cleanCellValue(unit);
    if (!rawUnit) {
        return null;
    }

    if (rawUnit === '构件' || rawUnit === '个构件') return '个构件';
    if (rawUnit === 'm²' || rawUnit === '㎡' || rawUnit === 'm2') return '㎡';
    if (rawUnit === 'm') return '米';
    return rawUnit;
}

function getQuantityUnitPriority(unit) {
    const normalizedUnit = normalizeQuantityUnit(unit);
    switch (normalizedUnit) {
    case '点':
        return 9;
    case '根':
        return 8;
    case '处':
        return 7;
    case '项':
        return 6;
    case '个构件':
        return 5;
    case '米':
    case '㎡':
        return 4;
    case '柱':
    case '梁':
    case '个':
        return 3;
    case '组':
        return 1;
    case '栋':
        return 0;
    default:
        return 2;
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
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return null;
    }

    return candidates
        .filter((candidate) => Number.isFinite(candidate.quantity))
        .sort((left, right) => {
            const priorityDiff = getQuantityUnitPriority(right.unit) - getQuantityUnitPriority(left.unit);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }
            return left.index - right.index;
        })[0] || null;
}

function parseQuantityField(value) {
    const quantityText = cleanCellValue(value);
    if (!quantityText) {
        return { quantity: 0, unit: null, quantityText: '' };
    }

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
        return {
            quantity: Number.parseFloat(compact),
            unit: null,
            quantityText,
        };
    }

    const bestCandidate = pickBestQuantityCandidate(extractQuantityCandidates(quantityText));
    if (bestCandidate) {
        return {
            quantity: bestCandidate.quantity,
            unit: bestCandidate.unit,
            quantityText,
        };
    }

    return {
        quantity: 0,
        unit: null,
        quantityText,
    };
}

function parseStaffNames(value) {
    return cleanCellValue(value)
        .split(/[、,，\s]+/u)
        .map((item) => item.replace(/[0-9\-+]/g, '').trim())
        .filter((item) => item.length >= 1 && item.length <= 10);
}

function composeRemarks(parts) {
    const extra = [];

    if (parts[5]) {
        extra.push(parts[5]);
    }
    if (parts[6]) {
        extra.push(`停车费 ${parts[6]}`);
    }
    if (parts[7]) {
        extra.push(`联系人 ${parts[7]}`);
    }

    return extra.join(' | ') || null;
}

function normalizeRows(rows, { sourceName = null, sheetName = null } = {}) {
    const parsed = [];

    rows.forEach((row, rowIndex) => {
        const parts = row.map(cleanCellValue);

        if (parts.every((part) => !part)) {
            return;
        }

        if (isTitleRow(parts) || isHeaderRow(parts)) {
            return;
        }

        if (parts.length < 3 || (!parts[1] && !parts[2])) {
            return;
        }

        const workDate = parseDateValue(parts[0]);
        if (!workDate) {
            parsed.push({
                error: true,
                raw: parts.join('\t'),
                rowIndex: rowIndex + 1,
                message: `无法识别日期: ${parts[0] || '(空)'}`,
            });
            return;
        }

        const quantityInfo = parseQuantityField(parts[3]);
        parsed.push({
            error: false,
            workDate,
            projectName: parts[1] || '未填写项目',
            testContent: parts[2] || '未填写内容',
            quantity: quantityInfo.quantity,
            unit: quantityInfo.unit,
            quantityText: quantityInfo.quantityText,
            staffNames: parseStaffNames(parts[4]),
            remarks: composeRemarks(parts),
            raw: parts.join('\t'),
            rowIndex: rowIndex + 1,
            sourceName,
            sheetName,
        });
    });

    return parsed;
}

function mergeRemarks(baseRemarks, extraNotes) {
    const values = [baseRemarks, extraNotes]
        .map((item) => cleanCellValue(item))
        .filter(Boolean);

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
    if (!rawText) {
        return '';
    }

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

    return {
        testContent: baseText,
        notes: baseContext,
    };
}

function expandDisplacementRow(row) {
    if (!/竖向位移|水平位移/u.test(row.quantityText || '')) {
        return null;
    }

    const lines = row.quantityText
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter(Boolean);

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
    if (!quantityText) {
        return null;
    }

    if (!/沉降|观测|布点|布\d|测\d|竖向|水平|倾斜|位移/u.test(`${baseText} ${quantityText}`)) {
        return null;
    }

    const normalizedText = quantityText
        .replace(/[，,；;]/gu, '、')
        .replace(/\s+/gu, '');
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

    if (segments.length === 0) {
        return null;
    }

    if (
        segments.length === 1
        && !/布|测|沉降|竖向|水平|倾斜|位移/u.test(segments[0].label)
    ) {
        return null;
    }

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
    if (!rawName) {
        return fallbackName;
    }

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
    if (!rawName) {
        return [];
    }

    if (/板厚.*层高|层高.*板厚/u.test(rawName)) {
        return ['板厚', '层高'];
    }

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
    if (itemNames.length === 0) {
        return;
    }

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
    if (!quantityText) {
        return null;
    }

    const normalizedText = quantityText
        .replace(/[，,；;]/gu, '、')
        .replace(/\s+/gu, '');
    const segments = normalizedText.split('、').filter(Boolean);

    if (segments.length === 0) {
        return null;
    }

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
            appendExpandedBundleItems(
                expanded,
                row,
                leadingQuantityMatch[2],
                leadingQuantityMatch[1],
                leadingQuantityMatch[2] === '保护层' ? '处' : '点',
            );
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

function needsModelExpansion(row) {
    if (!row || row.error || !row.quantityText) {
        return false;
    }

    if (/竖向位移|水平位移/u.test(row.quantityText)) {
        return false;
    }

    const hasBundleSignals = (
        /[\n*×xX]/u.test(row.quantityText)
        || /柱|梁|净高|板厚|层高|保护层|构件|植筋|回弹|贯入|沉降|竖向|水平|布\d|测\d/u.test(row.quantityText)
        || /[、,，/]/u.test(row.testContent)
    );

    if (!hasBundleSignals) {
        return false;
    }

    return (
        row.quantity === 0
        || /[\n*×xX、,，;；]/u.test(row.quantityText)
        || /[、,，/]/u.test(row.testContent)
        || /回弹|贯入|净高|层高|板厚|保护层|超声|构件|植筋|布\d|测\d/u.test(row.quantityText)
    );
}

function extractJsonPayload(content) {
    if (!content) {
        return null;
    }

    if (typeof content !== 'string') {
        return content;
    }

    try {
        return JSON.parse(content);
    } catch (error) {
        // continue
    }

    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/u);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1].trim());
        } catch (error) {
            // continue
        }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/u);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch (error) {
            // continue
        }
    }

    return null;
}

function normalizeModelItems(row, items) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items
        .map((item) => {
            const normalizedQuantity = item?.quantity === null || item?.quantity === undefined
                ? (items.length === 1 ? row.quantity : 0)
                : Number.parseFloat(item.quantity);

            const normalizedItem = createAtomicRow(row, {
                testContent: item?.testContent || item?.normalizedName || row.testContent,
                quantity: Number.isFinite(normalizedQuantity) ? normalizedQuantity : 0,
                unit: item?.unit || row.unit,
                notes: item?.notes || '',
            });

            return normalizedItem.testContent ? normalizedItem : null;
        })
        .filter(Boolean);
}

async function expandRowsWithModel(modelRows) {
    if (!modelRows.length || !hasTaskProvider('worklogMatching')) {
        return new Map();
    }

    const expandedByIndex = new Map();

    for (let offset = 0; offset < modelRows.length; offset += MODEL_BATCH_SIZE) {
        const batch = modelRows.slice(offset, offset + MODEL_BATCH_SIZE);
        const payload = {
            samples: batch.map(({ index, row }) => ({
                sampleId: index,
                date: row.workDate,
                projectName: row.projectName,
                testContent: row.testContent,
                quantityText: row.quantityText,
                unit: row.unit,
                remarks: row.remarks,
            })),
            outputSchema: {
                samples: [
                    {
                        sampleId: 'number',
                        items: [
                            {
                                testContent: 'string',
                                quantity: 'number|null',
                                unit: 'string|null',
                                notes: 'string',
                                confidence: 'number',
                            },
                        ],
                    },
                ],
            },
            preferredNames: COMMON_ITEM_NAMES,
        };

        try {
            const { result } = await requestTaskModel('worklogMatching', {
                messages: [
                    {
                        role: 'system',
                        content: [
                            'You convert engineering worklog rows into billable atomic inspection items.',
                            'Return JSON only.',
                            'Split combined rows into multiple items when needed.',
                            'Use concise Chinese test item names suitable for price matching.',
                            'Do not invent prices, staff, or contract details.',
                        ].join('\n'),
                    },
                    {
                        role: 'user',
                        content: JSON.stringify(payload),
                    },
                ],
                maxTokens: 1800,
                timeoutMs: 20000,
            });

            const content = result?.choices?.[0]?.message?.content || result?.choices?.[0]?.message?.reasoning_content || '';
            const parsed = extractJsonPayload(content);
            const samples = Array.isArray(parsed?.samples) ? parsed.samples : [];

            samples.forEach((sample) => {
                const target = batch.find((item) => item.index === sample.sampleId);
                if (!target) {
                    return;
                }

                const normalizedItems = normalizeModelItems(target.row, sample.items);
                if (normalizedItems.length > 0) {
                    expandedByIndex.set(target.index, normalizedItems);
                }
            });
        } catch (error) {
            console.warn('[WPS Parser] worklogMatching expansion failed:', error.message);
        }
    }

    return expandedByIndex;
}

export function parseWPSText(rawText) {
    if (!rawText || !rawText.trim()) {
        return [];
    }

    return normalizeRows(parseDelimitedRows(rawText), { sourceName: 'pasted-text' });
}

export function parseWPSWorkbook(fileBuffer, fileName = '') {
    const workbook = XLSX.read(fileBuffer, {
        type: 'buffer',
        cellDates: true,
    });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        raw: false,
        defval: '',
    });

    return {
        fileName,
        sheetName,
        rows: normalizeRows(rows, { sourceName: fileName || 'workbook', sheetName }),
    };
}

export async function expandWorklogRows(rows) {
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const expandedRows = new Array(normalizedRows.length);
    const rowsNeedingModel = [];

    normalizedRows.forEach((row, index) => {
        if (row?.error) {
            expandedRows[index] = [row];
            return;
        }

        const localExpanded = expandDisplacementRow(row);
        if (localExpanded?.length) {
            expandedRows[index] = localExpanded;
            return;
        }

        const observationExpanded = expandObservationBundleRow(row);
        if (observationExpanded?.length) {
            expandedRows[index] = observationExpanded;
            return;
        }

        const bundledExpanded = expandMethodBundleRow(row);
        if (bundledExpanded?.length) {
            expandedRows[index] = bundledExpanded;
            return;
        }

        if (needsModelExpansion(row)) {
            rowsNeedingModel.push({ index, row });
            return;
        }

        expandedRows[index] = [row];
    });

    const modelRows = rowsNeedingModel.slice(0, MAX_MODEL_ROWS_PER_IMPORT);
    const skippedRows = rowsNeedingModel.slice(MAX_MODEL_ROWS_PER_IMPORT);

    const modelExpanded = await expandRowsWithModel(modelRows);
    modelRows.forEach(({ index, row }) => {
        expandedRows[index] = modelExpanded.get(index) || [row];
    });
    skippedRows.forEach(({ index, row }) => {
        expandedRows[index] = [row];
    });

    return expandedRows.flatMap((items) => items || []);
}
