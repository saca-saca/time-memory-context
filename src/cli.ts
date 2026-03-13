#!/usr/bin/env node

import { MemoryContext } from './index';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * 解析命令行参数
 */
function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        result[key] = nextArg;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

interface CommandLineConfig {
  basePath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * 获取配置
 */
function getConfig(): CommandLineConfig {
  const configDir = path.join(os.homedir(), '.time-memory-context');
  const configFile = path.join(configDir, 'config.json');
  
  interface ConfigFile {
    basePath?: string;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
  }
  
  let config: ConfigFile = {};
  if (fs.existsSync(configFile)) {
    try {
      config = JSON.parse(fs.readFileSync(configFile, 'utf-8')) as ConfigFile;
    } catch (e) {
      // 忽略配置读取错误
    }
  }
  
  return {
    basePath: config.basePath || path.join(configDir, 'data'),
    logLevel: config.logLevel || 'info'
  };
}

/**
 * CLI 工具
 * 用于手动维护和管理记忆
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  // 处理版本命令
  if (command === '--version' || command === '-v') {
    console.log('1.0.0');
    return;
  }
  
  const verbose = args.includes('--verbose') || args.includes('-v');
  const parsedArgs = parseArgs(args.slice(1));

  const config = getConfig();
  
  // 确保数据目录存在
  if (!fs.existsSync(config.basePath)) {
    fs.mkdirSync(config.basePath, { recursive: true });
  }
  
  const mc = new MemoryContext({
    basePath: config.basePath,
    logLevel: verbose ? 'debug' : config.logLevel
  });

  try {
    await mc.initialize();
  } catch (error) {
    console.error('❌ 初始化失败:', error);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'maintenance':
        console.log('🧹 执行每日维护...');
        const result = await mc.runMaintenance();
        console.log('✅ 维护完成');
        console.log(`  - 清理: ${result.cleaned.length} 天`);
        console.log(`  - 归档: ${result.archived.length} 天`);
        if (result.errors.length > 0) {
          console.log(`  ⚠️  错误: ${result.errors.length} 个`);
          result.errors.forEach(e => console.log(`    - ${e}`));
          process.exit(1);
        }
        break;

      case 'stats':
        console.log('📊 统计信息');
        const stats = await mc.getStats();
        console.log(`  存储路径: ${stats.basePath}`);
        console.log(`  日文件: ${stats.dailyFiles} 个`);
        console.log(`  归档文件: ${stats.archiveFiles} 个`);
        console.log(`  WAL文件: ${stats.walFiles} 个 (保留30天)`);
        console.log(`  日志文件: ${stats.logFiles} 个 (保留7天)`);
        console.log(`  向量缓存: ${stats.vectorCacheSize} 条目`);
        break;

      case 'status':
        console.log('🔍 系统状态');
        const mode = mc.getRetrieverMode();
        console.log(`  搜索模式: ${mode === 'vector' ? '✅ 向量检索 (BGE-M3)' : '⚠️  关键词检索 (降级模式)'}`);
        const s = await mc.getStats();
        console.log(`  向量缓存: ${s.vectorCacheSize} 条目`);
        console.log(`  记忆文件: ${s.dailyFiles} 天 | ${s.archiveFiles} 归档`);
        if (mode === 'keyword') {
          console.log('\n  💡 提示: Ollama 不可用，已降级到关键词匹配');
          console.log('     如需启用向量检索，请运行: ollama serve');
        }
        break;

      case 'recall': {
        const query = args.slice(1).filter(a => !a.startsWith('-')).join(' ') || parsedArgs['query'];
        if (!query) {
          console.log('❌ 用法: recall <查询内容>');
          console.log('   示例: recall "项目进度"');
          process.exit(1);
        }
        console.log(`🔍 查询: "${query}"`);
        const memories = await mc.recall(query, parseInt(parsedArgs['top-k'] || '5'));
        if (memories.length === 0) {
          console.log('  未找到相关记忆');
        } else {
          console.log(`  找到 ${memories.length} 条记忆:`);
          memories.forEach((m, i) => {
            const tier = m.tier === 'short' ? '短期' : m.tier === 'medium' ? '中期' : '长期';
            console.log(`  ${i + 1}. [${tier}] ${m.source}: ${m.content.substring(0, 80)}...`);
          });
        }
        break;
      }

      case 'process': {
        // 核心命令：处理用户消息，返回组装好的上下文
        const userMessage = parsedArgs['message'] || args.slice(1).filter(a => !a.startsWith('--'))[0];
        if (!userMessage) {
          console.error('❌ 用法: process <用户消息>');
          console.error('   或: process --message "消息" --history "[...]" --system "prompt"');
          process.exit(1);
        }

        // 解析历史记录
        let history: Array<{role: string; content: string}> = [];
        if (parsedArgs['history']) {
          try {
            history = JSON.parse(parsedArgs['history']);
          } catch (e) {
            console.error('❌ --history 参数必须是有效的 JSON 数组');
            process.exit(1);
          }
        }

        // 系统提示
        const systemPrompt = parsedArgs['system'];

        // 处理消息
        const processResult = await mc.process(userMessage, history, systemPrompt);

        // 输出格式
        if (parsedArgs['output-format'] === 'json') {
          console.log(JSON.stringify(processResult, null, 2));
        } else {
          console.log('✅ 上下文组装完成');
          console.log(`  消息数量: ${processResult.messages.length}`);
          console.log(`  检索记忆: ${processResult.metadata.memoryCount} 条`);
          console.log(`  估算 Token: ${processResult.metadata.estimatedTokens}`);
          console.log(`  Token 节省: ${processResult.metadata.savings}%`);
          console.log('\n--- Messages ---');
          processResult.messages.forEach((m, i) => {
            console.log(`[${i}] ${m.role}: ${m.content.substring(0, 60)}${m.content.length > 60 ? '...' : ''}`);
          });
        }
        break;
      }

      case 'record': {
        // 记录助手回复
        const assistantMessage = parsedArgs['message'] || args.slice(1).filter(a => !a.startsWith('--'))[0];
        if (!assistantMessage) {
          console.error('❌ 用法: record <助手回复>');
          console.error('   或: record --message "回复内容"');
          process.exit(1);
        }

        await mc.recordAssistant(assistantMessage);
        
        if (parsedArgs['output-format'] !== 'json') {
          console.log('✅ 已记录助手回复');
        } else {
          console.log(JSON.stringify({ status: 'success', recorded: true }));
        }
        break;
      }

      case 'help':
      default:
        console.log('用法: time-memory-context <command> [options]');
        console.log('');
        console.log('Commands:');
        console.log('  process <message>     处理用户消息，返回组装好的上下文');
        console.log('                       --history "[...]" --system "prompt" --output-format json');
        console.log('  record <message>      记录助手回复');
        console.log('  recall <query>        查询历史记忆');
        console.log('  maintenance          执行每日维护');
        console.log('  stats                显示统计信息');
        console.log('  status               显示系统状态');
        console.log('  help                 显示帮助');
        console.log('');
        console.log('Options:');
        console.log('  -v, --verbose        详细日志');
        console.log('');
        console.log('Examples:');
        console.log('  time-memory-context process "帮我查一下项目进度" --history "[]" --system "你是助手" --output-format json');
        console.log('  time-memory-context record "项目进度已完成80%"');
        console.log('  time-memory-context recall "项目进度"');
        console.log('  time-memory-context maintenance');
        console.log('  time-memory-context status');
        if (command !== 'help') {
          process.exit(1);
        }
        break;
    }
  } catch (error) {
    console.error('❌ 命令执行失败:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ 未捕获的错误:', error);
  process.exit(1);
});
