import { Message, CompressedContext, SummarizerConfig } from '../types';

/**
 * 上下文压缩器
 * 保留最近 N 轮对话，老对话生成摘要
 */
export class ContextCompressor {
  private keepRounds: number;
  private summarizeThreshold: number;
  private summarizerConfig?: SummarizerConfig;
  private summaryCache: Map<string, string> = new Map(); // 缓存生成的摘要

  constructor(config: { 
    keepRounds: number; 
    summarizeThreshold: number;
    summarizerConfig?: SummarizerConfig;
  }) {
    this.keepRounds = config.keepRounds;
    this.summarizeThreshold = config.summarizeThreshold;
    this.summarizerConfig = config.summarizerConfig;
  }

  /**
   * 压缩对话历史（同步版本）
   * 如果需要异步摘要生成，请使用 compressAsync
   */
  compress(history: Message[]): CompressedContext {
    // 保留最近 N 轮
    const recentStart = Math.max(0, history.length - this.keepRounds * 2);
    const recent = history.slice(recentStart);
    
    // 更早的对话
    const older = history.slice(0, recentStart);
    
    let summary: string | null = null;
    let memoryCandidates: Message[] = [];

    if (older.length >= this.summarizeThreshold) {
      // 检查缓存中是否有已生成的摘要
      const cacheKey = this.generateCacheKey(older);
      summary = this.summaryCache.get(cacheKey) || this.generateSummarySync(older);
      
      // 提取可能的事实
      memoryCandidates = this.extractCandidates(older);
    } else if (older.length > 0) {
      // 不够阈值，全部作为候选
      memoryCandidates = older;
    }

    return {
      context: recent,
      summary,
      memoryCandidates,
      originalLength: history.length,
      compressedLength: recent.length
    };
  }

  /**
   * 压缩对话历史（异步版本）
   * 支持异步生成完整摘要并缓存结果
   */
  async compressAsync(history: Message[]): Promise<CompressedContext> {
    // 保留最近 N 轮
    const recentStart = Math.max(0, history.length - this.keepRounds * 2);
    const recent = history.slice(recentStart);
    
    // 更早的对话
    const older = history.slice(0, recentStart);
    
    let summary: string | null = null;
    let memoryCandidates: Message[] = [];

    if (older.length >= this.summarizeThreshold) {
      const cacheKey = this.generateCacheKey(older);
      
      // 检查缓存
      if (this.summaryCache.has(cacheKey)) {
        summary = this.summaryCache.get(cacheKey)!;
      } else {
        // 先生成同步摘要作为占位
        summary = this.generateSummarySync(older);
        
        // 异步生成完整摘要并缓存
        try {
          const fullSummary = await this.generateSummaryAsync(older);
          this.summaryCache.set(cacheKey, fullSummary);
          summary = fullSummary;
        } catch (e) {
          console.warn('Async summary generation failed, using sync fallback:', e);
        }
      }
      
      // 提取可能的事实
      memoryCandidates = this.extractCandidates(older);
    } else if (older.length > 0) {
      // 不够阈值，全部作为候选
      memoryCandidates = older;
    }

    return {
      context: recent,
      summary,
      memoryCandidates,
      originalLength: history.length,
      compressedLength: recent.length
    };
  }

  /**
   * 清除摘要缓存
   */
  clearSummaryCache(): void {
    this.summaryCache.clear();
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(messages: Message[]): string {
    // 使用消息内容哈希作为缓存键
    const content = messages.map(m => `${m.role}:${m.content}`).join('|');
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * 同步生成简单摘要（占位用）
   */
  private generateSummarySync(messages: Message[]): string {
    const keyPoints = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .filter(c => c.length > 20)
      .slice(-3);
    
    return `此前对话要点（待精炼）：${keyPoints.join('；')}`;
  }

  /**
   * 异步生成完整摘要（调用API）
   */
  private async generateSummaryAsync(messages: Message[]): Promise<string> {
    const config = this.summarizerConfig;
    
    if (!config || config.provider === 'openclaw') {
      // 默认使用 OpenClaw 配置的 API
      return this.callOpenClawAPI(messages);
    }
    
    switch (config.provider) {
      case 'openai':
        return this.callOpenAI(messages, config);
      case 'custom':
        return this.callCustomAPI(messages, config);
      default:
        return this.generateSummarySync(messages);
    }
  }

  /**
   * 调用 OpenClaw 配置的 API
   */
  private async callOpenClawAPI(messages: Message[]): Promise<string> {
    try {
      // 使用 OpenClaw 默认的模型配置
      const response = await fetch('http://localhost:18789/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN || ''}`
        },
        body: JSON.stringify({
          model: 'kimi-coding/k2p5',
          messages: [
            {
              role: 'system',
              content: '你是一个对话摘要助手。请将以下对话历史总结为3-5个要点，每个要点不超过50字。只输出要点，不要其他内容。'
            },
            {
              role: 'user',
              content: this.formatMessagesForSummary(messages)
            }
          ],
          temperature: 0.3,
          max_tokens: 200
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data: any = await response.json();
      return data.choices?.[0]?.message?.content || this.generateSummarySync(messages);
    } catch (error) {
      console.warn('OpenClaw API summary failed:', error);
      return this.generateSummarySync(messages);
    }
  }

  /**
   * 调用 OpenAI API
   */
  private async callOpenAI(messages: Message[], config: SummarizerConfig): Promise<string> {
    try {
      const response = await fetch(`${config.baseUrl || 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model || 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: 'Summarize the following conversation into 3-5 bullet points, max 50 chars each.'
            },
            {
              role: 'user',
              content: this.formatMessagesForSummary(messages)
            }
          ],
          temperature: 0.3,
          max_tokens: 200
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data: any = await response.json();
      return data.choices?.[0]?.message?.content || this.generateSummarySync(messages);
    } catch (error) {
      console.warn('OpenAI summary failed:', error);
      return this.generateSummarySync(messages);
    }
  }

  /**
   * 调用自定义 API
   */
  private async callCustomAPI(messages: Message[], config: SummarizerConfig): Promise<string> {
    try {
      const response = await fetch(config.baseUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` })
        },
        body: JSON.stringify({
          messages: this.formatMessagesForSummary(messages),
          max_length: config.maxLength || 200
        })
      });

      if (!response.ok) {
        throw new Error(`Custom API error: ${response.status}`);
      }

      const data: any = await response.json();
      return data.summary || data.text || this.generateSummarySync(messages);
    } catch (error) {
      console.warn('Custom API summary failed:', error);
      return this.generateSummarySync(messages);
    }
  }

  /**
   * 格式化消息用于摘要生成
   */
  private formatMessagesForSummary(messages: Message[]): string {
    return messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n')
      .substring(0, 8000); // 限制长度避免超出token限制
  }

  /**
   * 提取候选记忆
   */
  private extractCandidates(messages: Message[]): Message[] {
    return messages.filter(m => {
      // 过滤掉太短的、纯表意的消息
      if (m.content.length < 10) return false;
      if (/^(好的|嗯|哦|啊|ok|yes|no)[。！]?$/i.test(m.content)) return false;
      return true;
    });
  }

  /**
   * 计算节省的 Token 数
   */
  calculateSavings(original: Message[], compressed: CompressedContext): {
    originalTokens: number;
    compressedTokens: number;
    savedTokens: number;
    savePercent: number;
  } {
    const originalTokens = this.estimateTokens(original);
    const compressedTokens = this.estimateTokens(compressed.context);
    const savedTokens = originalTokens - compressedTokens;
    
    return {
      originalTokens,
      compressedTokens,
      savedTokens,
      savePercent: Math.round((savedTokens / originalTokens) * 100)
    };
  }

  /**
   * 估算 Token 数（简化版：1 token ≈ 4 chars）
   */
  private estimateTokens(messages: Message[]): number {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(totalChars / 4);
  }
}
