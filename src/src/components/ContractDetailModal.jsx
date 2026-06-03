'use client';

import { useEffect, useState } from 'react';

function buildDraftItems(contract) {
    if (!Array.isArray(contract?.priceItems)) {
        return [];
    }

    return contract.priceItems.map((item) => ({
        id: item.id ?? null,
        testCategory: item.testCategory || '',
        testItemName: item.testItemName || '',
        quantity: item.quantity ?? '',
        unit: item.unit || '',
        unitPrice: item.unitPrice ?? '',
    }));
}

function formatCurrency(value) {
    return `¥${Number(value || 0).toLocaleString()}`;
}

function formatPrice(value) {
    return `¥${Number(value || 0).toFixed(2)}`;
}

function getItemSubtotal(item) {
    return (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
}

function getTotalAmount(items) {
    return items.reduce((sum, item) => sum + getItemSubtotal(item), 0);
}

function getContractSummary(contract) {
    return [
        contract.clientName && `委托方：${contract.clientName}`,
        contract.partyB && `受托方：${contract.partyB}`,
        contract.signedDate && `签订日期：${new Date(contract.signedDate).toLocaleDateString('zh-CN')}`,
        ({
            area: `按面积计价 · 总价 ${formatCurrency(contract.areaPricingAmount)} · 面积 ${contract.areaPricingArea || '-'}`,
            mixed: `混合计费 · 面积部分 ${formatCurrency(contract.areaPricingAmount)} · 面积 ${contract.areaPricingArea || '-'}`,
            lumpsum: `包干价 · 总价 ${formatCurrency(contract.lumpSumAmount)}`,
        }[contract.pricingMode] || '按单价计价'),
    ].filter(Boolean).join(' · ');
}

export default function ContractDetailModal({
    contract,
    onClose,
    editable = false,
    saving = false,
    onSavePriceItems,
    onEditContract,
}) {
    const [draftItems, setDraftItems] = useState(() => buildDraftItems(contract));

    useEffect(() => {
        setDraftItems(buildDraftItems(contract));
    }, [contract]);

    if (!contract) {
        return null;
    }

    const totalAmount = getTotalAmount(draftItems);
    const canSave = editable && typeof onSavePriceItems === 'function';

    const updatePriceItem = (index, key, value) => {
        setDraftItems((current) => current.map((item, itemIndex) => (
            itemIndex === index
                ? { ...item, [key]: value }
                : item
        )));
    };

    const addPriceItem = () => {
        setDraftItems((current) => [
            ...current,
            {
                id: null,
                testCategory: '',
                testItemName: '',
                quantity: '',
                unit: '',
                unitPrice: '',
            },
        ]);
    };

    const removePriceItem = (index) => {
        setDraftItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    };

    const handleSave = async () => {
        if (!canSave) {
            return;
        }

        await onSavePriceItems(draftItems);
    };

    const tableColumnCount = canSave ? 8 : 6;

    return (
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
            onClick={() => {
                if (!saving) {
                    onClose();
                }
            }}
        >
            <div
                className="card stack"
                style={{ width: '90%', maxWidth: 940, padding: 24, maxHeight: '80vh', overflow: 'auto' }}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="panel-eyebrow">Contract Detail</div>
                <div className="panel-title" style={{ marginBottom: 4 }}>
                    {contract.contractNo || `合同 #${contract.id}`}
                </div>
                <div className="panel-note" style={{ marginBottom: canSave ? 8 : 16 }}>
                    {getContractSummary(contract)}
                </div>

                {canSave ? (
                    <div className="panel-note" style={{ marginBottom: 16 }}>
                        可直接修改下方检测项目清单，保存后会覆盖当前合同里的价目表。
                    </div>
                ) : null}

                {canSave ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <strong>检测项目清单</strong>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ minHeight: 28, padding: '0 10px', fontSize: '0.72rem' }}
                            onClick={addPriceItem}
                            disabled={saving}
                        >
                            + 新增一行
                        </button>
                    </div>
                ) : null}

                <div className="data-table-shell">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ width: 56 }}>序号</th>
                                {canSave ? <th style={{ width: 180 }}>检测类别</th> : null}
                                <th>检测项目</th>
                                <th style={{ width: 120 }}>数量</th>
                                <th style={{ width: 100 }}>单位</th>
                                <th style={{ width: 130 }}>单价</th>
                                <th style={{ width: 140 }}>小计</th>
                                {canSave ? <th style={{ width: 70 }}>操作</th> : null}
                            </tr>
                        </thead>
                        <tbody>
                            {draftItems.length === 0 ? (
                                <tr>
                                    <td colSpan={tableColumnCount} style={{ textAlign: 'center', color: 'var(--color-muted)' }}>
                                        {canSave ? '暂无检测项目，可点击“新增一行”补充。' : '该合同暂无检测项目清单'}
                                    </td>
                                </tr>
                            ) : draftItems.map((item, index) => (
                                <tr key={item.id || `draft-${index}`}>
                                    <td style={{ textAlign: 'center', color: 'var(--color-muted)' }}>{index + 1}</td>
                                    {canSave ? (
                                        <td>
                                            <input
                                                className="form-input"
                                                value={item.testCategory}
                                                onChange={(event) => updatePriceItem(index, 'testCategory', event.target.value)}
                                                disabled={saving}
                                            />
                                        </td>
                                    ) : null}
                                    <td>
                                        {canSave ? (
                                            <input
                                                className="form-input"
                                                value={item.testItemName}
                                                onChange={(event) => updatePriceItem(index, 'testItemName', event.target.value)}
                                                disabled={saving}
                                            />
                                        ) : (
                                            item.testItemName || '-'
                                        )}
                                    </td>
                                    <td>
                                        {canSave ? (
                                            <input
                                                className="form-input"
                                                type="text"
                                                inputMode="decimal"
                                                value={item.quantity}
                                                onChange={(event) => updatePriceItem(index, 'quantity', event.target.value)}
                                                disabled={saving}
                                            />
                                        ) : (
                                            item.quantity ?? '-'
                                        )}
                                    </td>
                                    <td>
                                        {canSave ? (
                                            <input
                                                className="form-input"
                                                value={item.unit}
                                                onChange={(event) => updatePriceItem(index, 'unit', event.target.value)}
                                                disabled={saving}
                                            />
                                        ) : (
                                            item.unit || '-'
                                        )}
                                    </td>
                                    <td>
                                        {canSave ? (
                                            <input
                                                className="form-input"
                                                type="text"
                                                inputMode="decimal"
                                                value={item.unitPrice}
                                                onChange={(event) => updatePriceItem(index, 'unitPrice', event.target.value)}
                                                disabled={saving}
                                            />
                                        ) : (
                                            formatPrice(item.unitPrice)
                                        )}
                                    </td>
                                    <td>{formatPrice(getItemSubtotal(item))}</td>
                                    {canSave ? (
                                        <td>
                                            <button
                                                type="button"
                                                className="btn btn-danger"
                                                style={{ minHeight: 24, padding: '0 8px', fontSize: '0.68rem' }}
                                                onClick={() => removePriceItem(index)}
                                                disabled={saving}
                                            >
                                                删
                                            </button>
                                        </td>
                                    ) : null}
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colSpan={canSave ? 6 : 5} style={{ textAlign: 'right', fontWeight: 600 }}>合计</td>
                                <td style={{ fontWeight: 600 }}>{formatCurrency(totalAmount)}</td>
                                {canSave ? <td /> : null}
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div className="page-actions" style={{ marginTop: 16 }}>
                    <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>关闭</button>
                    {typeof onEditContract === 'function' ? (
                        <button type="button" className="btn btn-secondary" onClick={onEditContract} disabled={saving}>编辑合同</button>
                    ) : null}
                    {canSave ? (
                        <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
                            {saving ? '保存中...' : '保存修改'}
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
