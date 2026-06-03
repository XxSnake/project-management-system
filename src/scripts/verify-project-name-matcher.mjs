import { PrismaClient } from '@prisma/client';
import {
    analyzeProjectNameResolution,
    scoreProjectNameSimilarity,
} from '../src/lib/projectNameMatcher.js';

const prisma = new PrismaClient();

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function main() {
    const sampleProjects = [
        { id: 1, name: '清华园', phase: null, buildingMode: false, contractId: null },
        { id: 2, name: 'A项目-建宁路', phase: null, buildingMode: false, contractId: null },
        { id: 3, name: 'A项目(一期)', phase: null, buildingMode: false, contractId: null },
        { id: 4, name: 'A项目宿舍楼', phase: null, buildingMode: false, contractId: null },
        { id: 5, name: '滇西大西校区', phase: null, buildingMode: false, contractId: null },
    ];

    const checks = [];

    const exactSame = await analyzeProjectNameResolution('清华园', { projects: sampleProjects });
    assert(exactSame.status === 'exact' && exactSame.exactProjectId === 1, 'case1 失败：完全相同应为 exact');
    checks.push('case1 PASS exact same');

    const exactSpace = await analyzeProjectNameResolution('清华园 ', { projects: sampleProjects });
    assert(exactSpace.status === 'exact' && exactSpace.exactProjectId === 1, 'case2 失败：空格差异应为 exact');
    checks.push('case2 PASS trim exact');

    const fuzzyDash = await analyzeProjectNameResolution('A项目建宁路', { projects: sampleProjects });
    assert(fuzzyDash.status === 'fuzzy', 'case3 失败：中划线差异应为 fuzzy');
    assert((fuzzyDash.candidates[0]?.score || 0) >= 0.9, `case3 失败：分数不足 0.9，当前 ${(fuzzyDash.candidates[0]?.score || 0).toFixed(4)}`);
    checks.push(`case3 PASS fuzzy dash ${(fuzzyDash.candidates[0]?.score || 0).toFixed(4)}`);

    const exactBracket = await analyzeProjectNameResolution('A项目（一期）', { projects: sampleProjects });
    assert(exactBracket.status === 'exact' && exactBracket.exactProjectId === 3, 'case4 失败：全角半角括号应为 exact');
    checks.push('case4 PASS fullwidth exact');

    const noneDifferent = await analyzeProjectNameResolution('完全陌生工程', { projects: sampleProjects });
    assert(noneDifferent.status === 'none', 'case5 失败：完全不同应为 none');
    checks.push('case5 PASS none');

    const fuzzySubset = await analyzeProjectNameResolution('A 项目', { projects: sampleProjects });
    assert(fuzzySubset.status === 'fuzzy', 'case6 失败：子集应为 fuzzy');
    const subsetScore = fuzzySubset.candidates[0]?.score || 0;
    assert(subsetScore >= 0.6 && subsetScore <= 0.8, `case6 失败：子集分数应在 0.6-0.8，当前 ${subsetScore.toFixed(4)}`);
    checks.push(`case6 PASS subset ${(subsetScore).toFixed(4)}`);

    const buildingProject = await prisma.project.findUnique({
        where: { id: 829 },
        select: {
            id: true,
            name: true,
            phase: true,
            buildingMode: true,
            contractId: true,
        },
    });
    assert(buildingProject?.buildingMode && buildingProject?.phase, 'case7 失败：数据库里的 #829 不满足 buildingMode + phase 条件');

    const buildingInput = `${buildingProject.name}（${buildingProject.phase}3#保育室）`;
    const buildingResolution = await analyzeProjectNameResolution(buildingInput, {
        projects: [buildingProject],
    });
    assert(buildingResolution.status === 'fuzzy', 'case7 失败：buildingMode 子项单体应为 fuzzy');
    const buildingCandidate = buildingResolution.candidates.find((item) => item.project.id === 829);
    assert(buildingCandidate, 'case7 失败：候选里缺少 #829');
    assert(buildingCandidate.matchedAs === 'building-in-subproject', 'case7 失败：matchedAs 不是 building-in-subproject');
    assert(buildingCandidate.buildingName === '3#保育室', `case7 失败：buildingName 应为 3#保育室，当前 ${buildingCandidate.buildingName}`);
    checks.push(`case7 PASS building ${(buildingCandidate.score).toFixed(4)}`);

    console.log('verify-project-name-matcher');
    checks.forEach((item) => console.log(item));
    console.log(`score-sample ${scoreProjectNameSimilarity('A项目建宁路', 'A项目-建宁路').toFixed(4)}`);
    console.log('ALL PASS');
}

main()
    .catch((error) => {
        console.error(`FAIL: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
