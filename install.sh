#!/bin/bash
# Time Memory Context - 一键安装脚本
# 支持: Linux, macOS

set -e

# 颜色 - 使用 tput 提高兼容性
if command -v tput &> /dev/null && [ -n "$TERM" ] && [ "$TERM" != "dumb" ]; then
    RED=$(tput setaf 1)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    NC=$(tput sgr0)
else
    RED=''
    GREEN=''
    YELLOW=''
    NC=''
fi

# 配置
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
NODE_MIN_VERSION="18"

echo "🧠 Time Memory Context 安装脚本"
echo "================================"

# 检查 Node.js
check_node() {
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js 未安装${NC}"
        echo "   请先安装 Node.js >= 18"
        echo "   推荐: https://nodejs.org/ 或使用 nvm"
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]; then
        echo -e "${RED}❌ Node.js 版本过低${NC}"
        echo "   当前: $(node -v)"
        echo "   需要: >= 18.0.0"
        exit 1
    fi

    echo -e "${GREEN}✅ Node.js 版本: $(node -v)${NC}"
}

# 检查 npm
check_npm() {
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}❌ npm 未安装${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ npm 版本: $(npm -v)${NC}"
}

# 检查 jq（可选）
check_jq() {
    if command -v jq &> /dev/null; then
        echo -e "${GREEN}✅ jq 已安装${NC}"
    else
        echo -e "${YELLOW}⚠️  jq 未安装（可选，用于解析 JSON 输出）${NC}"
        echo "   建议安装: apt install jq / brew install jq"
    fi
}

# 安装 TMC
install_tmc() {
    echo ""
    echo "📦 安装 time-memory-context..."

    # 检查是否已安装
    if command -v time-memory-context &> /dev/null; then
        CURRENT_VERSION=$(time-memory-context --version 2>/dev/null || echo "unknown")
        echo -e "${YELLOW}⚠️  time-memory-context 已安装 (版本: $CURRENT_VERSION)${NC}"
        read -p "是否重新安装? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "取消安装"
            return
        fi
    fi

    # 从源码安装（如果在源码目录）
    if [ -f "package.json" ] && grep -q "time-memory-context" package.json 2>/dev/null; then
        echo "   检测到源码目录，从源码安装..."
        npm install
        npm run build
        npm link
    else
        # 从 npm 安装
        echo "   从 npm 安装..."
        npm install -g time-memory-context
    fi

    if command -v time-memory-context &> /dev/null; then
        echo -e "${GREEN}✅ time-memory-context 安装成功${NC}"
        echo "   版本: $(time-memory-context --version 2>/dev/null || echo 'unknown')"
    else
        echo -e "${RED}❌ 安装失败${NC}"
        exit 1
    fi
}

# 安装辅助脚本
install_scripts() {
    echo ""
    echo "📜 安装辅助脚本..."

    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # 安装 auto-tmc.sh
    if [ -f "$SCRIPT_DIR/auto-tmc.sh" ]; then
        chmod +x "$SCRIPT_DIR/auto-tmc.sh"
        echo -e "${GREEN}✅ auto-tmc.sh 已就绪${NC}"
        echo "   使用: ./auto-tmc.sh check '[历史JSON]'"
    fi

    # 安装 smart-context.sh
    if [ -f "$SCRIPT_DIR/examples/smart-context.sh" ]; then
        chmod +x "$SCRIPT_DIR/examples/smart-context.sh"
        echo -e "${GREEN}✅ smart-context.sh 已就绪${NC}"
        echo "   使用: ./examples/smart-context.sh \"消息\" \"[历史]\""
    fi
}

# 初始化配置
init_config() {
    echo ""
    echo "⚙️  初始化配置..."

    CONFIG_DIR="$HOME/.time-memory-context"
    mkdir -p "$CONFIG_DIR/data"

    if [ ! -f "$CONFIG_DIR/config.json" ]; then
        cat > "$CONFIG_DIR/config.json" << 'EOF'
{
  "keepRounds": 3,
  "maxTokens": 4000,
  "basePath": "~/.time-memory-context/data",
  "enableRetrieval": true,
  "logLevel": "info"
}
EOF
        echo -e "${GREEN}✅ 配置文件已创建: $CONFIG_DIR/config.json${NC}"
    else
        echo -e "${YELLOW}⚠️  配置文件已存在: $CONFIG_DIR/config.json${NC}"
    fi
}

# 检查 Ollama
check_ollama() {
    echo ""
    echo "🔍 检查 Ollama（可选，用于向量检索）..."

    if command -v ollama &> /dev/null; then
        echo -e "${GREEN}✅ Ollama 已安装${NC}"

        # 检查 bge-m3
        if ollama list | grep -q "bge-m3"; then
            echo -e "${GREEN}✅ BGE-M3 模型已安装${NC}"
        else
            echo -e "${YELLOW}⚠️  BGE-M3 模型未安装${NC}"
            echo "   如需向量检索，请运行: ollama pull bge-m3"
        fi

        # 检查 ollama 服务
        if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Ollama 服务正在运行${NC}"
        else
            echo -e "${YELLOW}⚠️  Ollama 服务未启动${NC}"
            echo "   请运行: ollama serve"
        fi
    else
        echo -e "${YELLOW}⚠️  Ollama 未安装（可选）${NC}"
        echo "   向量检索将降级为关键词匹配"
        echo "   如需安装: curl -fsSL https://ollama.com/install.sh | sh"
    fi
}

# 测试安装
test_install() {
    echo ""
    echo "🧪 测试安装..."

    # 测试 process
    RESULT=$(time-memory-context process "测试消息" --history "[]" --output-format json 2>/dev/null)
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ process 命令正常${NC}"
    else
        echo -e "${RED}❌ process 命令失败${NC}"
    fi

    # 测试 status
    time-memory-context status > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ status 命令正常${NC}"
    else
        echo -e "${YELLOW}⚠️  status 命令可能有问题${NC}"
    fi
}

# 显示使用说明
show_usage() {
    echo ""
    echo "================================"
    echo -e "${GREEN}🎉 安装完成!${NC}"
    echo ""
    echo "快速开始:"
    echo "  1. 处理消息:"
    echo "     time-memory-context process \"你好\" --history \"[]\" --output-format json"
    echo ""
    echo "  2. 检查是否需要压缩:"
    echo "     ./auto-tmc.sh check '[{\"role\":\"user\",\"content\":\"你好\"}]'"
    echo ""
    echo "  3. 配置自动压缩:"
    echo "     将配置模板添加到 SOUL.md（见 SKILL.md）"
    echo ""
    echo "更多命令:"
    echo "  time-memory-context --help"
    echo "  ./auto-tmc.sh config"
    echo ""
    echo "文档:"
    echo "  SKILL.md - OpenClaw 使用指南"
    echo "  README.md - 完整文档"
}

# 主流程
main() {
    check_node
    check_npm
    check_jq
    install_tmc
    install_scripts
    init_config
    check_ollama
    test_install
    show_usage
}

# 处理参数
case "${1:-}" in
    --help|-h)
        echo "用法: $0 [选项]"
        echo ""
        echo "选项:"
        echo "  --help, -h     显示帮助"
        echo "  --check        仅检查环境，不安装"
        echo ""
        echo "环境变量:"
        echo "  INSTALL_DIR    安装目录 (默认: /usr/local/bin)"
        exit 0
        ;;
    --check)
        check_node
        check_npm
        check_jq
        check_ollama
        exit 0
        ;;
    *)
        main
        ;;
esac
