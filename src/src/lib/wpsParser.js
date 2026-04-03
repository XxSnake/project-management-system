import * as XLSX from 'xlsx';

import { hasTaskProvider, requestTaskModel } from '@/lib/modelGateway';

const SIMPLE_QUANTITY_REGEX = /^(\d+(?:\.\d+)?)\s*([\u4e00-\u9fa5A-Za-z%]+)?$/u;
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
            unit: simpleMatch[2] || null,
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
    if (rawName.includes('板厚')) return '板厚';
    if (rawName.includes('保护层')) return '保护层';

    return rawName;
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
            expanded.push(createAtomicRow(row, {
                testContent: normalizeBundleItemName(multiplierMatch[1], row.testContent),
                quantity: multiplierMatch[2],
                unit: '处',
            }));
            return;
        }

        const namedBeamColumnMatch = segment.match(/^([^\d]+?)(\d+(?:\.\d+)?)柱(\d+(?:\.\d+)?)梁$/u);
        if (namedBeamColumnMatch) {
            const itemName = normalizeBundleItemName(namedBeamColumnMatch[1], row.testContent);
            expanded.push(createAtomicRow(row, {
                testContent: itemName,
                quantity: namedBeamColumnMatch[2],
                unit: '柱',
            }));
            expanded.push(createAtomicRow(row, {
                testContent: itemName,
                quantity: namedBeamColumnMatch[3],
                unit: '梁',
            }));
            return;
        }

        const beamColumnWithNameMatch = segment.match(/^(\d+(?:\.\d+)?)柱(\d+(?:\.\d+)?)梁[（(]([^）)]+)[）)]$/u);
        if (beamColumnWithNameMatch) {
            const itemName = normalizeBundleItemName(beamColumnWithNameMatch[3], row.testContent);
            expanded.push(createAtomicRow(row, {
                testContent: itemName,
                quantity: beamColumnWithNameMatch[1],
                unit: '柱',
            }));
            expanded.push(createAtomicRow(row, {
                testContent: itemName,
                quantity: beamColumnWithNameMatch[2],
                unit: '梁',
            }));
            return;
        }

        const leadingQuantityMatch = segment.match(/^(\d+(?:\.\d+)?)(净高|板厚|保护层)$/u);
        if (leadingQuantityMatch) {
            expanded.push(createAtomicRow(row, {
                testContent: normalizeBundleItemName(leadingQuantityMatch[2], row.testContent),
                quantity: leadingQuantityMatch[1],
                unit: leadingQuantityMatch[2] === '保护层' ? '点' : '处',
            }));
            return;
        }

        const genericMatch = segment.match(/^(.+?)(\d+(?:\.\d+)?)(柱|梁|点|项|处|个|组|根)$/u);
        if (genericMatch) {
            expanded.push(createAtomicRow(row, {
                testContent: normalizeBundleItemName(genericMatch[1], row.testContent),
                quantity: genericMatch[2],
                unit: genericMatch[3] === '个' ? '处' : genericMatch[3],
            }));
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
        || /柱|梁|净高|板厚|保护层|回弹|贯入/u.test(row.quantityText)
        || /[、,，]/u.test(row.testContent)
    );

    if (!hasBundleSignals) {
        return false;
    }

    return (
        row.quantity === 0
        || /[\n*×xX、,，;；]/u.test(row.quantityText)
        || /[、,，]/u.test(row.testContent)
        || /回弹|贯入|净高|板厚|保护层|超声/u.test(row.quantityText)
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
