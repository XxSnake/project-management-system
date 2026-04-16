import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const matcherPath = path.join(__dirname, '../src/lib/worklogMatching.js');

function loadUnitHelpers() {
    const source = fs.readFileSync(matcherPath, 'utf8');
    const fragments = [
        source.match(/const UNIT_COMPATIBILITY_GROUPS = new Map\(\[[\s\S]*?\]\);/u)?.[0],
        source.match(/export function normalizeUnitForMatching\(unit\) \{[\s\S]*?\n\}/u)?.[0],
        source.match(/function resolveUnitCompatibilityGroup\(unit\) \{[\s\S]*?\n\}/u)?.[0],
        source.match(/export function areUnitsCompatibleForMatching\(workLogUnit, candidateUnit\) \{[\s\S]*?\n\}/u)?.[0],
    ].filter(Boolean);

    if (fragments.length !== 4) {
        throw new Error('未找到完整的单位兼容规则源码片段');
    }

    const snippet = fragments.join('\n\n').replace(/export function /gu, 'function ');

    return new Function(`
${snippet}
return { normalizeUnitForMatching, areUnitsCompatibleForMatching };
`)();
}

function matchWithUnitGuard(workLog, candidates, areUnitsCompatibleForMatching) {
    const compatibleCandidates = candidates.filter((candidate) => (
        areUnitsCompatibleForMatching(workLog.unit, candidate.unit)
    ));

    return compatibleCandidates.length > 0 ? compatibleCandidates : null;
}

function assertCase(caseName, passed, detail) {
    const line = `${passed ? 'PASS' : 'FAIL'} ${caseName}: ${detail}`;
    console.log(line);
    if (!passed) {
        process.exitCode = 1;
    }
}

const { normalizeUnitForMatching, areUnitsCompatibleForMatching } = loadUnitHelpers();

const incompatibleResult = matchWithUnitGuard(
    {
        testContent: '沉降观测',
        unit: '点',
    },
    [
        {
            id: 'area-1',
            testItemName: '竖向变形观测',
            unit: 'm²',
            unitPrice: 0.6,
        },
    ],
    areUnitsCompatibleForMatching,
);

assertCase(
    '点 对 m² 必须拦截',
    incompatibleResult === null,
    incompatibleResult === null
        ? '返回 null'
        : `错误保留了 ${incompatibleResult.length} 个候选`,
);

const compatibleResult = matchWithUnitGuard(
    {
        testContent: '实体检测',
        unit: '个构件',
    },
    [
        {
            id: 'component-1',
            testItemName: '混凝土强度(综合法)',
            unit: '个',
            unitPrice: 180,
        },
    ],
    areUnitsCompatibleForMatching,
);

assertCase(
    '个构件 对 个 应保留',
    Array.isArray(compatibleResult) && compatibleResult.length === 1,
    Array.isArray(compatibleResult)
        ? `保留 ${compatibleResult.length} 个候选`
        : '被错误拦截',
);

assertCase(
    '单位归一化 平方米 -> m²',
    normalizeUnitForMatching('平方米') === 'm²',
    `归一化结果: ${normalizeUnitForMatching('平方米')}`,
);

if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode);
}
