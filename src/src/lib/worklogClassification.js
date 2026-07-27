export function isNonBillableLayoutWork(workLog) {
    const text = String(workLog?.testContent || '').trim();

    if (!text) {
        return false;
    }

    return /布点|布设|点位布设/u.test(text) || /^布$/u.test(text);
}

export function getNonWorkloadReason(workLog) {
    const testContent = String(workLog?.testContent || '').trim();
    const remarks = String(workLog?.remarks || '').trim();
    const rawText = String(workLog?.rawText || workLog?.raw || '').trim();
    const allText = [testContent, remarks, rawText].filter(Boolean).join(' ');

    if (
        /方案(?:编制|编写|制作)/u.test(testContent)
        || /(?:编制|编写|制作).{0,12}方案/u.test(testContent)
    ) {
        return '方案编制';
    }

    if (
        /出报告/u.test(testContent)
        || /报告(?:出具|编制|编写|制作)/u.test(testContent)
        || /(?:出具|编制|编写|制作).{0,8}报告/u.test(testContent)
    ) {
        return '出报告';
    }

    if (/(?:取消|撤销)(?:检测|检验|试验|工作)?/u.test(allText)) {
        return '已取消';
    }

    if (
        /未(?:检测|检验|试验|进行|开展|实施|完成)/u.test(allText)
        || /没有(?:检测|检验|试验|进行|开展|实施|完成)/u.test(allText)
    ) {
        return '未检测';
    }

    return null;
}

export function isNonWorkloadWork(workLog) {
    return getNonWorkloadReason(workLog) !== null;
}
