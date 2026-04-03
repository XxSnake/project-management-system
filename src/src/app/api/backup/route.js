import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

function getDbPath() {
    return path.join(process.cwd(), 'prisma', 'dev.db');
}

function getBackupsDir() {
    return path.join(process.cwd(), '..', 'backups');
}

function ensureBackupsDir() {
    const backupsDir = getBackupsDir();
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }
    return backupsDir;
}

function createBackupFileName(date = new Date()) {
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    const timeStr = date.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
    return `db_backup_${dateStr}_${timeStr}.db`;
}

function buildDownloadUrl(fileName) {
    return `/api/backup?name=${encodeURIComponent(fileName)}`;
}

function toBackupMeta(fileName) {
    const filePath = path.join(getBackupsDir(), fileName);
    const stats = fs.statSync(filePath);

    return {
        name: fileName,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
        downloadUrl: buildDownloadUrl(fileName),
    };
}

function listBackups() {
    const backupsDir = ensureBackupsDir();

    return fs.readdirSync(backupsDir)
        .filter((fileName) => fileName.toLowerCase().endsWith('.db'))
        .map(toBackupMeta)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function downloadFile(filePath, fileName) {
    const stats = fs.statSync(filePath);
    const data = fs.readFileSync(filePath);

    return new NextResponse(data, {
        status: 200,
        headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': stats.size.toString(),
        },
    });
}

// GET - list backups or download a backup file
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('name');
    const download = searchParams.get('download');

    try {
        if (download === 'current') {
            const dbPath = getDbPath();
            if (!fs.existsSync(dbPath)) {
                return NextResponse.json({ error: '数据库文件不存在' }, { status: 404 });
            }

            return downloadFile(dbPath, createBackupFileName());
        }

        if (fileName) {
            const safeFileName = path.basename(fileName);
            const targetPath = path.join(getBackupsDir(), safeFileName);

            if (!fs.existsSync(targetPath)) {
                return NextResponse.json({ error: '备份文件不存在' }, { status: 404 });
            }

            return downloadFile(targetPath, safeFileName);
        }

        return NextResponse.json(listBackups());
    } catch (error) {
        console.error('Database backup error:', error);
        return NextResponse.json({ error: '备份失败: ' + error.message }, { status: 500 });
    }
}

// POST - create a new SQLite snapshot in /backups
export async function POST() {
    try {
        const dbPath = getDbPath();

        if (!fs.existsSync(dbPath)) {
            return NextResponse.json({ error: '数据库文件不存在' }, { status: 404 });
        }

        const backupsDir = ensureBackupsDir();
        const fileName = createBackupFileName();
        const targetPath = path.join(backupsDir, fileName);

        fs.copyFileSync(dbPath, targetPath);

        return NextResponse.json({
            success: true,
            fileName,
            backup: toBackupMeta(fileName),
        });
    } catch (error) {
        console.error('Create backup error:', error);
        return NextResponse.json({ error: '备份失败: ' + error.message }, { status: 500 });
    }
}
