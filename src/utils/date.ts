import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 日期工具
 */

/**
 * 获取今天的日期字符串 (YYYY-MM-DD)
 */
export function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * 获取 N 天前的日期字符串
 */
export function getDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

/**
 * 解析日期字符串为 Date 对象
 */
export function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00.000Z');
}

/**
 * 计算两个日期之间的天数差
 */
export function daysBetween(a: string, b: string): number {
  const d1 = parseDate(a).getTime();
  const d2 = parseDate(b).getTime();
  return Math.floor(Math.abs(d1 - d2) / (1000 * 60 * 60 * 24));
}

/**
 * 获取日期范围列表
 */
export function getDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let current = new Date(start + 'T00:00:00.000Z');
  const endDate = new Date(end + 'T00:00:00.000Z');

  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * 格式化日期显示
 */
export function formatDate(dateStr: string, format: 'short' | 'long' = 'short'): string {
  const date = parseDate(dateStr);
  
  if (format === 'short') {
    return dateStr.substring(5); // MM-DD
  }

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  });
}

/**
 * 获取相对时间描述
 */
export function getRelativeTime(dateStr: string): string {
  const days = daysBetween(dateStr, getToday());
  
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  if (days < 365) return `${Math.floor(days / 30)}个月前`;
  return `${Math.floor(days / 365)}年前`;
}
