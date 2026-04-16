export function isNonBillableLayoutWork(workLog) {
    const text = String(workLog?.testContent || '').trim();

    if (!text) {
        return false;
    }

    return /布点|布设|点位布设/u.test(text) || /^布$/u.test(text);
}
