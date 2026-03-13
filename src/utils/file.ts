import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 文件操作工具类
 */
export class FileUtils {
  /**
   * 确保目录存在
   */
  static async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (e) {
      // 忽略已存在错误
    }
  }

  /**
   * 检查文件是否存在
   */
  static async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 安全读取 JSON 文件
   */
  static async readJSON<T = any>(filePath: string, defaultValue?: T): Promise<T> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (e) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw e;
    }
  }

  /**
   * 安全写入 JSON 文件
   */
  static async writeJSON(filePath: string, data: any, pretty = true): Promise<void> {
    await FileUtils.ensureDir(path.dirname(filePath));
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * 追加到文件
   */
  static async appendFile(filePath: string, content: string): Promise<void> {
    await FileUtils.ensureDir(path.dirname(filePath));
    await fs.appendFile(filePath, content, 'utf-8');
  }

  /**
   * 删除文件（忽略不存在错误）
   */
  static async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (e) {
      // 忽略不存在错误
    }
  }

  /**
   * 获取 N 天前的日期字符串
   */
  static getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * 列出目录中的文件
   */
  static async listFiles(dirPath: string, pattern?: RegExp): Promise<string[]> {
    try {
      const files = await fs.readdir(dirPath);
      if (pattern) {
        return files.filter(f => pattern.test(f));
      }
      return files;
    } catch (e) {
      return [];
    }
  }

  /**
   * 获取文件大小（可读格式）
   */
  static async getFileSize(filePath: string): Promise<string> {
    try {
      const stats = await fs.stat(filePath);
      const bytes = stats.size;
      
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    } catch (e) {
      return '0 B';
    }
  }

  /**
   * 获取目录总大小
   */
  static async getDirSize(dirPath: string): Promise<number> {
    let total = 0;
    
    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const file of files) {
        const filePath = path.join(dirPath, file.name);
        
        if (file.isDirectory()) {
          total += await FileUtils.getDirSize(filePath);
        } else {
          const stats = await fs.stat(filePath);
          total += stats.size;
        }
      }
    } catch (e) {
      // 忽略错误
    }
    
    return total;
  }
}

// 同时导出独立函数，方便使用
export const ensureDir = FileUtils.ensureDir;
export const fileExists = FileUtils.exists;
export const readJson = FileUtils.readJSON;
export const writeJson = FileUtils.writeJSON;
export const appendJsonl = FileUtils.appendFile;
export const safeDelete = FileUtils.deleteFile;
export const listFiles = FileUtils.listFiles;
export const getFileSize = FileUtils.getFileSize;
export const getDirSize = FileUtils.getDirSize;
