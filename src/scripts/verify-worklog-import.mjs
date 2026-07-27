import {
    expandWorklogRows,
    parseWPSText,
} from '../src/lib/wpsParser.js';
import {
    getNonWorkloadReason,
    isNonWorkloadWork,
} from '../src/lib/worklogClassification.js';
import { analyzeProjectNameResolution } from '../src/lib/projectNameMatcher.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function hasItem(rows, rowIndex, testContent, quantity, unit) {
    return rows.some((row) => (
        row.rowIndex === rowIndex
        && row.testContent === testContent
        && Number(row.quantity) === Number(quantity)
        && row.unit === unit
    ));
}

async function verifyParserAndClassification() {
    const rawText = [
        '2026-01-29\t示例项目\t植筋拉拔\t6圆32根，12圆4根\t张三\t',
        '2026-03-11\t示例项目\t沉降 实体检测\t测25点 实体2组\t张三\t',
        '2026-04-23\t示例项目\t水电，环境，沉降\t2组水压，6点等电位，环境14点，沉降8点\t张三\t',
        '2026-05-13\t示例项目\t钢结构焊缝\t共64条焊缝\t张三\t',
        '2026-02-03\t示例项目\t编制边坡变形监测方案\t\t张三\t',
        '2026-02-12\t示例项目\t沉降观测\t/\t张三\t现场取消检测',
        '2026-03-25\t示例项目\t沉降出报告\t/\t张三\t最终报告',
        '2026-04-27\t示例项目\t保温层钻芯\t\t张三\t未施工完未检测',
        '2026-05-25\t示例项目\t钢结构涂层\t10点\t张三\t检测数据不合格',
    ].join('\n');
    const parsed = parseWPSText(rawText);
    const expanded = await expandWorklogRows(parsed);

    assert(
        hasItem(expanded, 1, '植筋拉拔', 32, '根')
        && hasItem(expanded, 1, '植筋拉拔', 4, '根'),
        '植筋规格未正确拆分',
    );
    assert(
        hasItem(expanded, 2, '沉降观测', 25, '点')
        && hasItem(expanded, 2, '实体检测', 2, '组'),
        '沉降和实体检测未正确拆分',
    );
    assert(
        hasItem(expanded, 3, '水压试验', 2, '组')
        && hasItem(expanded, 3, '等电位', 6, '点')
        && hasItem(expanded, 3, '环境检测', 14, '点')
        && hasItem(expanded, 3, '沉降观测', 8, '点'),
        '水压、等电位、环境和沉降未正确拆分',
    );
    assert(hasItem(expanded, 4, '钢结构焊缝', 64, '条'), '焊缝数量未正确识别');
    assert(new Set(expanded.map((row) => row.previewKey)).size === expanded.length, '预览行标识重复');

    const expectedReasons = new Map([
        [5, '方案编制'],
        [6, '已取消'],
        [7, '出报告'],
        [8, '未检测'],
    ]);
    expectedReasons.forEach((reason, rowIndex) => {
        const row = parsed.find((item) => item.rowIndex === rowIndex);
        assert(getNonWorkloadReason(row) === reason, `第 ${rowIndex} 条未识别为 ${reason}`);
    });
    assert(!isNonWorkloadWork(parsed.find((row) => row.rowIndex === 9)), '已检测但不合格的记录不应排除');
}

async function verifyProjectMatching() {
    const buildingProject = {
        id: 829,
        name: '云南省洱海流域山水林田湖草沙一体化保护和修复工程',
        phase: '古生种质资源二期',
        buildingMode: true,
        contractId: 10,
    };
    const buildingInput = `${buildingProject.name}--${buildingProject.phase}1#保育室项目`;
    const buildingResolution = await analyzeProjectNameResolution(buildingInput, {
        projects: [buildingProject],
    });
    assert(buildingResolution.candidates[0]?.matchedAs === 'building-in-subproject', '分期单体未优先匹配');
    assert(buildingResolution.candidates[0]?.buildingName === '1#保育室', '单体名称提取错误');

    const schoolProject = {
        id: 849,
        name: '弥渡县第一完全中学整体搬迁项目',
        phase: '二期三号教学楼',
        buildingMode: false,
        contractId: 11,
    };
    const schoolResolution = await analyzeProjectNameResolution('弥渡一中3#教学楼', {
        projects: [schoolProject],
    });
    assert(schoolResolution.candidates[0]?.project.id === 849, '学校简称未匹配到三号教学楼');

    const gasProjects = [
        {
            id: 848,
            name: '弥渡县燃气管道等老化更新建设项目',
            phase: null,
            buildingMode: false,
            contractId: null,
        },
        {
            id: 813,
            name: '弥渡县燃气管道老化更新建设项目',
            phase: '二期二标段',
            buildingMode: false,
            contractId: 12,
        },
    ];
    const gasResolution = await analyzeProjectNameResolution(
        '弥渡县燃气管道等老化更新建设项目-（二期）EPC模式（二标段）',
        { projects: gasProjects },
    );
    assert(gasResolution.candidates[0]?.project.id === 813, '未优先匹配燃气二期二标段');
}

await verifyParserAndClassification();
await verifyProjectMatching();

console.log('verify-worklog-import');
console.log('ALL PASS');
