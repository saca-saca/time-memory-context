import { Message, CompressedContext, MemorySnippet } from '../types';

/**
 * 上下文组装器
 * 将压缩后的上下文 + 检索到的记忆 组装成最终 prompt
 * 特性：
 * - 健壮的错误处理
 * - Token 限制检查
 * - 智能截断
 */
export class ContextAssembler {
  private maxTokens: number;
  private maxMemorySnippets: number;

  constructor(config: { maxTokens?: number; maxMemorySnippets?: number }) {
    this.maxTokens = config.maxTokens || 4000;
    this.maxMemorySnippets = config.maxMemorySnippets || 3;
  }

  /**
   * 组装最终上下文
   */
  assemble(
    compressed: CompressedContext, 
    memories: MemorySnippet[],
    systemPrompt?: string,
    currentUserMessage?: string
  ): AssembledContext {
    try {
      const messages: Message[] = [];
      const metadata: AssemblyMetadata = {
        originalLength: compressed.originalLength,
        compressedLength: compressed.compressedLength,
        memoryCount: 0,
        estimatedTokens: 0,
        savings: 0,
        truncated: false
      };

      // 1. 添加 system prompt
      if (systemPrompt) {
        messages.push({
          role: 'system',
          content: systemPrompt
        });
      }

      // 2. 添加长期记忆（压缩到 system 中）
      try {
        const longTermMemories = memories.filter(m => m.tier === 'long').slice(0, 2);
        if (longTermMemories.length > 0) {
          const memoryContext = this.formatLongTermMemories(longTermMemories);
          const systemMsg = messages.find(m => m.role === 'system');
          if (systemMsg) {
            systemMsg.content += '\n\n' + memoryContext;
          } else {
            messages.push({
              role: 'system',
              content: memoryContext
            });
          }
          metadata.memoryCount += longTermMemories.length;
        }
      } catch (e) {
        console.warn('Failed to format long term memories:', e);
      }

      // 3. 添加历史摘要
      if (compressed.summary) {
        messages.push({
          role: 'system',
          content: `[历史摘要] ${compressed.summary}`
        });
      }

      // 4. 添加中期记忆
      try {
        const mediumTermMemories = memories.filter(m => m.tier === 'medium').slice(0, this.maxMemorySnippets);
        if (mediumTermMemories.length > 0) {
          messages.push({
            role: 'system',
            content: `[相关记忆]\n${this.formatMediumTermMemories(mediumTermMemories)}`
          });
          metadata.memoryCount += mediumTermMemories.length;
        }
      } catch (e) {
        console.warn('Failed to format medium term memories:', e);
      }

      // 5. 添加近期对话（压缩后的）
      messages.push(...compressed.context);

      // 6. 添加当前用户消息
      if (currentUserMessage) {
        messages.push({
          role: 'user',
          content: currentUserMessage
        });
      }

      // 7. 检查 Token 限制并截断
      const checked = this.enforceTokenLimit(messages);
      metadata.truncated = checked.truncated;

      // 7. 计算统计
      metadata.estimatedTokens = this.estimateTokens(checked.messages);
      metadata.savings = Math.round(
        (1 - metadata.estimatedTokens / (compressed.originalLength * 50)) * 100
      );

      return {
        messages: checked.messages,
        metadata
      };
    } catch (error) {
      console.error('Assemble failed:', error);
      // 降级：返回最基本的信息
      return {
        messages: compressed.context,
        metadata: {
          originalLength: compressed.originalLength,
          compressedLength: compressed.compressedLength,
          memoryCount: 0,
          estimatedTokens: this.estimateTokens(compressed.context),
          savings: 0,
          truncated: true,
          error: String(error)
        }
      };
    }
  }

  /**
   * Token 限制检查与截断
   */
  private enforceTokenLimit(messages: Message[]): { messages: Message[]; truncated: boolean } {
    const estimated = this.estimateTokens(messages);
    
    if (estimated <= this.maxTokens) {
      return { messages, truncated: false };
    }

    // 需要截断：优先保留 system 和最近的用户消息
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    
    // 保留最近的用户/助手对话
    const recentMessages = nonSystemMessages.slice(-4);
    
    const truncated = [...systemMessages, ...recentMessages];
    
    // 如果还超，再截断 system 消息
    const finalEstimated = this.estimateTokens(truncated);
    if (finalEstimated > this.maxTokens) {
      // 简化 system 消息
      const simplifiedSystem = truncated
        .filter(m => m.role === 'system')
        .map(m => ({
          ...m,
          content: m.content.substring(0, 500) + (m.content.length > 500 ? '...' : '')
        }));
      
      return {
        messages: [...simplifiedSystem, ...recentMessages],
        truncated: true
      };
    }

    return { messages: truncated, truncated: true };
  }

  /**
   * 格式化长期记忆（归档摘要）
   */
  private formatLongTermMemories(memories: MemorySnippet[]): string {
    try {
      const lines = memories.map(m => {
        const content = m.content ? m.content.substring(0, 200) : '';
        return `- ${content}`;
      });
      return `[长期记忆]\n${lines.join('\n')}`;
    } catch (e) {
      return '[长期记忆]\n- 加载失败';
    }
  }

  /**
   * 格式化中期记忆
   */
  private formatMediumTermMemories(memories: MemorySnippet[]): string {
    try {
      return memories
        .map(m => {
          const content = m.content ? m.content.substring(0, 150) : '';
          return `${m.source}: ${content}...`;
        })
        .join('\n');
    } catch (e) {
      return '- 加载失败';
    }
  }

  /**
   * 估算 token 数（简化版）
   */
  private estimateTokens(messages: Message[]): number {
    try {
      let chars = 0;
      for (const m of messages) {
        chars += (m.content || '').length;
        chars += (m.role || '').length;
      }
      return Math.ceil(chars / 4);
    } catch (e) {
      // 失败时返回一个保守估计
      return messages.length * 500;
    }
  }
}

export interface AssembledContext {
  messages: Message[];
  metadata: AssemblyMetadata;
}

export interface AssemblyMetadata {
  originalLength: number;
  compressedLength: number;
  memoryCount: number;
  estimatedTokens: number;
  savings: number;
  truncated: boolean;
  error?: string;
}
