import fs from "fs";
import path from "path";

/**
 * Bulletproof Multi-Directory Storage Path Resolver & Atomic File Storage Engine
 * Inspired by Coolify & Rails ActiveStorage
 * Ensures state files are safely loaded and saved per tenant without race conditions,
 * regardless of whether the process was launched from the repository root or 'web/'.
 */

export function resolveDataDir(): string {
  if (process.env.DATA_DIR && fs.existsSync(process.env.DATA_DIR)) {
    return process.env.DATA_DIR;
  }

  const cwd = process.cwd();
  const webDir = path.join(cwd, "web");
  if (fs.existsSync(webDir) && fs.statSync(webDir).isDirectory()) {
    const dataInWeb = path.join(webDir, "data");
    if (!fs.existsSync(dataInWeb)) {
      try { fs.mkdirSync(dataInWeb, { recursive: true }); } catch {}
    }
    return dataInWeb;
  }

  const rootData = path.join(cwd, "data");
  if (!fs.existsSync(rootData)) {
    try { fs.mkdirSync(rootData, { recursive: true }); } catch {}
  }
  return rootData;
}

export function resolveDataFilePath(filename: string): string {
  // 1. Explicit environment variable path (e.g. Render persistent disk /data)
  if (process.env.DATA_DIR && fs.existsSync(process.env.DATA_DIR)) {
    return path.join(process.env.DATA_DIR, filename);
  }

  const cwd = process.cwd();
  const rootPath = path.join(cwd, filename);
  const webSubdirPath = path.join(cwd, "web", filename);

  // If file already exists in web/ subdirectory, prefer it
  if (fs.existsSync(webSubdirPath)) {
    return webSubdirPath;
  }

  // If file exists directly in cwd, use it
  if (fs.existsSync(rootPath)) {
    return rootPath;
  }

  // If 'web' directory exists in cwd, place it inside web/ by default
  const webDir = path.join(cwd, "web");
  if (fs.existsSync(webDir) && fs.statSync(webDir).isDirectory()) {
    return webSubdirPath;
  }

  return rootPath;
}

/**
 * Resolve tenant-isolated file path: <dataDir>/users/<userId>/<filename>
 */
export function resolveUserStoragePath(userId: string, filename: string): string {
  const safeUserId = (userId || "default_tenant").replace(/[^a-zA-Z0-9_-]/g, "_");
  const dataDir = resolveDataDir();
  const userDir = path.join(dataDir, "users", safeUserId);

  if (!fs.existsSync(userDir)) {
    try {
      fs.mkdirSync(userDir, { recursive: true });
    } catch (e: any) {
      console.warn(`[STORAGE] Could not create user dir ${userDir}:`, e.message);
    }
  }

  return path.join(userDir, filename);
}

/**
 * Atomic JSON write with temporary file rename
 * Prevents zero-byte corruption during VPS reboots or abrupt process terminations.
 */
export function atomicSaveJsonFile(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }

  const jsonStr = JSON.stringify(data, null, 2);
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;

  try {
    fs.writeFileSync(tempPath, jsonStr, "utf-8");
    try {
      fs.renameSync(tempPath, filePath);
    } catch {
      // Windows fallback if rename throws EPERM/EBUSY
      fs.copyFileSync(tempPath, filePath);
      try { fs.unlinkSync(tempPath); } catch {}
    }
  } catch (err: any) {
    console.error(`[STORAGE] Atomic save failed for ${filePath}:`, err.message);
    // Direct write fallback
    try {
      fs.writeFileSync(filePath, jsonStr, "utf-8");
    } catch {}
  }
}

/**
 * Read data file safely with fallback
 */
export function readDataFile<T>(filename: string, defaultValue: T): T {
  try {
    const filePath = resolveDataFilePath(filename);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as T;
    }
  } catch (err: any) {
    console.warn(`[STORAGE] Could not read ${filename}:`, err.message);
  }
  return defaultValue;
}

/**
 * Save data file safely to primary path AND mirror to sibling path if applicable
 */
export function saveDataFile(filename: string, data: any): void {
  const primaryPath = resolveDataFilePath(filename);
  atomicSaveJsonFile(primaryPath, data);

  // Dual-persistence: Also mirror to root or web/ to avoid cwd mismatch on restart
  try {
    const cwd = process.cwd();
    const rootPath = path.join(cwd, filename);
    const webPath = path.join(cwd, "web", filename);

    if (primaryPath === webPath && rootPath !== webPath) {
      atomicSaveJsonFile(rootPath, data);
    } else if (fs.existsSync(path.join(cwd, "web")) && primaryPath === rootPath) {
      atomicSaveJsonFile(webPath, data);
    }
  } catch {}
}

/**
 * Tenant-scoped safe read with fallback
 */
export function readUserDataFile<T>(userId: string, filename: string, defaultValue: T): T {
  try {
    const userFilePath = resolveUserStoragePath(userId, filename);
    if (fs.existsSync(userFilePath)) {
      const content = fs.readFileSync(userFilePath, "utf-8");
      return JSON.parse(content) as T;
    }
  } catch (err: any) {
    console.warn(`[STORAGE] Could not read user ${userId} file ${filename}:`, err.message);
  }
  return defaultValue;
}

/**
 * Tenant-scoped atomic write
 */
export function saveUserDataFile(userId: string, filename: string, data: any): void {
  const userFilePath = resolveUserStoragePath(userId, filename);
  atomicSaveJsonFile(userFilePath, data);
}
