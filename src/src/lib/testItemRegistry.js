/**
 * 标准检测项目注册表
 *
 * 所有合同 OCR 识别和工作记录匹配都以此列表为基准。
 * 每个条目包含：
 *   - name:       标准名称（唯一）
 *   - category:   所属检测类别
 *   - aliases:    别名 / 常见变体（用于模糊匹配）
 *   - unit:       默认计量单位（可选，仅作参考）
 */

export const STANDARD_TEST_ITEMS = [
    // ========== 地基基础 ==========
    { name: '轻型动力触探', category: '地基基础', aliases: ['轻便触探', '轻型触探', '动力触探', '动探'], unit: '点' },
    { name: '低应变法', category: '地基基础', aliases: ['低应变', '低应变检测', '小应变'], unit: '根' },
    { name: '声波透射法', category: '地基基础', aliases: ['声波透射', '超声波透射', '声波透射检测'], unit: '根' },
    { name: '单桩竖向抗压静载试验', category: '地基基础', aliases: ['抗压静载', '竖向抗压', '单桩静载', '桩基抗压', '竖向抗压静载'], unit: '根' },
    { name: '单桩竖向抗拔静载试验', category: '地基基础', aliases: ['抗拔静载', '竖向抗拔', '桩基抗拔', '竖向抗拔静载'], unit: '根' },
    { name: '复合地基', category: '地基基础', aliases: ['复合地基检测', '复合地基承载力', '复合地基载荷试验'], unit: '点' },
    { name: '浅层平板载荷试验', category: '地基基础', aliases: ['平板载荷', '浅层载荷', '地基载荷试验', '平板载荷试验'], unit: '点' },
    { name: '锚杆抗拔承载力', category: '地基基础', aliases: ['锚杆抗拔', '锚杆拉拔', '锚杆承载力'], unit: '根' },

    // ========== 主体结构 ==========
    { name: '粘结材料粘合加固材与基材的正拉结强度', category: '主体结构', aliases: ['正拉结强度', '粘结强度检测', '正拉结', '粘结材料强度'], unit: '组' },
    { name: '锚固承载力', category: '主体结构', aliases: ['锚固力', '锚固检测', '锚固承载力检测'], unit: '组' },
    { name: '给排水管通球试验', category: '主体结构', aliases: ['通球试验', '通球', '管道通球'], unit: '次' },
    { name: '无压管道的严密性试验（闭水试验）', category: '主体结构', aliases: ['闭水试验', '闭水', '严密性试验', '无压管道闭水'], unit: '次' },
    { name: '压力管道水压试验', category: '主体结构', aliases: ['水压试验', '管道水压', '压力管道试压'], unit: '次' },
    { name: '灌水试验', category: '主体结构', aliases: ['灌水', '灌水检测'], unit: '次' },
    { name: '绝缘电阻', category: '主体结构', aliases: ['绝缘电阻检测', '绝缘电阻测试'], unit: '点' },
    { name: '接地电阻', category: '主体结构', aliases: ['接地电阻检测', '接地电阻测试'], unit: '点' },
    { name: '混凝土强度（回弹法）', category: '主体结构', aliases: ['回弹法', '回弹', '混凝土回弹', '砼回弹'], unit: '处' },
    { name: '混凝土强度（超声回弹综合法）', category: '主体结构', aliases: ['超声回弹', '超声回弹综合', '综合法', '超声回弹法'], unit: '处' },
    { name: '混凝土强度（钻芯法）', category: '主体结构', aliases: ['钻芯法', '钻芯', '芯样检测'], unit: '个' },
    { name: '混凝土强度（回弹钻芯综合法）', category: '主体结构', aliases: ['回弹钻芯综合', '回弹钻芯'], unit: '处' },
    { name: '砂浆强度（贯入法）', category: '主体结构', aliases: ['砂浆贯入', '砂浆贯入法', '贯入法'], unit: '处' },
    { name: '砂浆强度（回弹法）', category: '主体结构', aliases: ['砂浆回弹', '砂浆回弹法'], unit: '处' },
    { name: '砖强度（回弹法）', category: '主体结构', aliases: ['砖回弹', '砖回弹法', '砖强度回弹'], unit: '处' },
    { name: '钢筋保护层厚度', category: '主体结构', aliases: ['保护层', '保护层厚度', '保护层检测', '钢筋保护层'], unit: '处' },
    { name: '板厚', category: '主体结构', aliases: ['板厚检测', '楼板厚度'], unit: '点' },
    { name: '净高', category: '主体结构', aliases: ['净高检测', '层高', '净高测量'], unit: '点' },
    { name: '锈蚀状况', category: '主体结构', aliases: ['锈蚀', '钢筋锈蚀', '锈蚀检测'], unit: '处' },
    { name: '静载试验', category: '主体结构', aliases: ['静载', '楼板静载', '结构静载'], unit: '次' },
    { name: '后置埋件现场拉拔力（植筋）', category: '主体结构', aliases: ['植筋拉拔', '植筋', '后置埋件植筋', '植筋检测'], unit: '组' },
    { name: '后置埋件现场拉拔力（螺栓）', category: '主体结构', aliases: ['螺栓拉拔', '化学螺栓', '后置埋件螺栓', '螺栓检测', '膨胀螺栓'], unit: '组' },
    { name: '饰面砖粘结强度', category: '主体结构', aliases: ['饰面砖', '饰面砖粘结', '面砖粘结', '面砖粘结强度'], unit: '组' },
];

/**
 * 标准名称集合（快速查找）
 */
export const STANDARD_NAME_SET = new Set(STANDARD_TEST_ITEMS.map((item) => item.name));

/**
 * 名称 → 标准条目映射（含别名）
 */
const NAME_LOOKUP = new Map();
STANDARD_TEST_ITEMS.forEach((item) => {
    NAME_LOOKUP.set(normalize(item.name), item);
    (item.aliases || []).forEach((alias) => {
        NAME_LOOKUP.set(normalize(alias), item);
    });
});

function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[\s()（）\[\]【】\-_/\\,，。:：;；]/gu, '');
}

/**
 * 精确查找：给定一个名称，尝试精确匹配到标准检测项目
 * @returns {{ name, category, aliases, unit } | null}
 */
export function findExactStandardItem(name) {
    if (!name) return null;
    return NAME_LOOKUP.get(normalize(name)) || null;
}

/**
 * 模糊匹配：给定一个名称，返回得分最高的标准检测项目及得分
 * @returns {{ item, score } | null}
 */
export function findBestStandardItem(name) {
    if (!name) return null;

    const normalizedInput = normalize(name);

    // 先尝试精确查找
    const exact = NAME_LOOKUP.get(normalizedInput);
    if (exact) {
        return { item: exact, score: 1.0 };
    }

    // 模糊匹配
    let bestItem = null;
    let bestScore = 0;

    for (const item of STANDARD_TEST_ITEMS) {
        const candidates = [item.name, ...(item.aliases || [])];
        for (const candidate of candidates) {
            const normalizedCandidate = normalize(candidate);
            let score = 0;

            // 完全包含
            if (normalizedInput.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedInput)) {
                const lenRatio = Math.min(normalizedInput.length, normalizedCandidate.length)
                    / Math.max(normalizedInput.length, normalizedCandidate.length);
                score = 0.85 + lenRatio * 0.1;
            } else {
                // Dice coefficient
                score = diceCoefficient(normalizedInput, normalizedCandidate);
            }

            if (score > bestScore) {
                bestScore = score;
                bestItem = item;
            }
        }
    }

    return bestScore >= 0.5 ? { item: bestItem, score: bestScore } : null;
}

function diceCoefficient(left, right) {
    if (!left || !right) return 0;
    if (left === right) return 1;

    const getBigrams = (text) => {
        if (text.length < 2) return [text];
        const bigrams = [];
        for (let i = 0; i < text.length - 1; i++) {
            bigrams.push(text.slice(i, i + 2));
        }
        return bigrams;
    };

    const leftBigrams = getBigrams(left);
    const rightBigrams = getBigrams(right);
    const rightCounts = new Map();
    rightBigrams.forEach((b) => rightCounts.set(b, (rightCounts.get(b) || 0) + 1));

    let intersection = 0;
    leftBigrams.forEach((b) => {
        const count = rightCounts.get(b) || 0;
        if (count > 0) {
            intersection += 1;
            rightCounts.set(b, count - 1);
        }
    });

    return (2 * intersection) / (leftBigrams.length + rightBigrams.length);
}

/**
 * 对 OCR 识别出的价目表项目进行标准化过滤
 * - 精确匹配 → 直接映射为标准名称
 * - 模糊匹配 (score >= 0.75) → 标记为 "需确认"，附带建议的标准名称
 * - 无法匹配 → 标记为 "自定义项目"
 *
 * @param {Array} ocrPriceItems - OCR 识别出的 priceItems 数组
 * @returns {{ items: Array, needsConfirmation: boolean }}
 */
export function normalizeOcrPriceItems(ocrPriceItems) {
    if (!Array.isArray(ocrPriceItems)) {
        return { items: [], needsConfirmation: false };
    }

    let needsConfirmation = false;

    const items = ocrPriceItems.map((item) => {
        const testItemName = (item.testItemName || '').trim();
        if (!testItemName) return item;

        const exact = findExactStandardItem(testItemName);
        if (exact) {
            return {
                ...item,
                testItemName: exact.name,
                testCategory: item.testCategory || exact.category,
                _matchStatus: 'exact',
                _standardName: exact.name,
            };
        }

        const fuzzy = findBestStandardItem(testItemName);
        if (fuzzy && fuzzy.score >= 0.75) {
            needsConfirmation = true;
            return {
                ...item,
                _matchStatus: 'fuzzy',
                _standardName: fuzzy.item.name,
                _matchScore: Number(fuzzy.score.toFixed(3)),
                _originalName: testItemName,
            };
        }

        return {
            ...item,
            _matchStatus: 'custom',
            _originalName: testItemName,
        };
    });

    return { items, needsConfirmation };
}

/**
 * 获取所有标准项目（分组展示用）
 */
export function getGroupedStandardItems() {
    const groups = new Map();
    for (const item of STANDARD_TEST_ITEMS) {
        if (!groups.has(item.category)) {
            groups.set(item.category, []);
        }
        groups.get(item.category).push(item);
    }
    return Object.fromEntries(groups);
}
