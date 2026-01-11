# Roam Migration Tool - System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     React + Antd Frontend                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐│
│  │ File     │  │ Rule     │  │ Preview  │  │ Progress         ││
│  │ Selector │  │ Config   │  │ Diff     │  │ Dashboard        ││
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │ HTTP/WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Express API Server                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐│
│  │ /scan    │  │ /preview │  │ /migrate │  │ /rollback        ││
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Core Engine                              │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐│
│  │ FileScanner    │  │ Transformer    │  │ BackupManager      ││
│  │ - glob files   │  │ - apply rules  │  │ - create snapshot  ││
│  │ - read content │  │ - track changes│  │ - restore backup   ││
│  └────────────────┘  └────────────────┘  └────────────────────┘│
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐│
│  │ RuleRegistry   │  │ ConfigLoader   │  │ MigrationLog       ││
│  │ - built-in     │  │ - YAML/JSON    │  │ - operation log    ││
│  │ - custom rules │  │ - validation   │  │ - incremental      ││
│  └────────────────┘  └────────────────┘  └────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure (Monorepo)

```
note_migration/
├── packages/
│   ├── core/                    # 核心转换引擎
│   │   ├── src/
│   │   │   ├── rules/           # 转换规则
│   │   │   │   ├── index.ts
│   │   │   │   ├── todo.ts      # TODO/DONE 转换
│   │   │   │   ├── highlight.ts # 高亮转换
│   │   │   │   ├── link.ts      # 链接路径转换
│   │   │   │   └── heptabase.ts # Heptabase 兼容
│   │   │   ├── scanner/         # 文件扫描
│   │   │   ├── transformer/     # 转换执行器
│   │   │   ├── backup/          # 备份管理
│   │   │   ├── config/          # 配置加载
│   │   │   └── types/           # 类型定义
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── server/                  # API 服务
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── websocket/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── web/                     # React 前端
│       ├── src/
│       │   ├── components/
│       │   │   ├── FileSelector/
│       │   │   ├── RuleConfig/
│       │   │   ├── PreviewDiff/
│       │   │   └── ProgressDashboard/
│       │   ├── pages/
│       │   ├── hooks/
│       │   ├── services/
│       │   └── App.tsx
│       └── package.json
│
├── .ab-method/                  # AB Method 任务跟踪
├── docs/
│   ├── architecture/
│   └── plans/
├── package.json                 # Workspace root
├── pnpm-workspace.yaml
└── tsconfig.json
```

## Core Interfaces

### TransformRule Interface

```typescript
interface TransformRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;

  // 匹配模式
  pattern: RegExp;

  // 转换函数
  transform: (match: string, ...groups: string[]) => string;

  // 可选：验证函数
  validate?: (content: string) => boolean;
}
```

### Built-in Rules

```typescript
const builtInRules: TransformRule[] = [
  {
    id: 'todo',
    name: 'TODO Checkbox',
    pattern: /\{\{\[\[TODO\]\]\}\}/g,
    transform: () => '[ ]',
    priority: 10,
  },
  {
    id: 'done',
    name: 'DONE Checkbox',
    pattern: /\{\{\[\[DONE\]\]\}\}/g,
    transform: () => '[x]',
    priority: 10,
  },
  {
    id: 'highlight',
    name: 'Highlight Syntax',
    pattern: /\^\^(.+?)\^\^/g,
    transform: (_, text) => `==${text}==`,
    priority: 20,
  },
  {
    id: 'link-flatten',
    name: 'Flatten Link Paths',
    pattern: /\[\[([^\/\]]+?)\/([^\]]+?)\]\]/g,
    transform: (_, folder, note) => `[[${folder}_${note}]]`,
    priority: 30,
  },
  {
    id: 'heptabase-proto',
    name: 'Heptabase Proto Fix',
    pattern: /\[\[(__proto__|constructor)\]\]/g,
    transform: (_, name) => `[[JS_${name}]]`,
    priority: 40,
  },
  {
    id: 'frontmatter-clean',
    name: 'Clean YAML Frontmatter',
    pattern: /^-\s*---\n\s*title:.*\n\s*---\n-/gm,
    transform: () => '-',
    priority: 50,
  },
];
```

### MigrationConfig

```typescript
interface MigrationConfig {
  // 源目录
  sourceDir: string;

  // 输出目录
  outputDir: string;

  // 模式
  mode: 'copy' | 'in-place';

  // 功能开关
  dryRun: boolean;
  incremental: boolean;
  createBackup: boolean;

  // 规则配置
  rules: {
    enabled: string[];    // 启用的规则 ID
    disabled: string[];   // 禁用的规则 ID
    custom: CustomRule[]; // 自定义规则
  };

  // 文件过滤
  include: string[];  // glob patterns
  exclude: string[];

  // 文件重命名
  flattenDirectories: boolean;
  fileNamePattern: '{folder}_{filename}';
}
```

## Data Flow

### Migration Process

```
1. SCAN
   ├─ Read source directory
   ├─ Filter files by patterns
   └─ Build file list with metadata

2. PREVIEW (Dry-run)
   ├─ Apply all rules to each file (in memory)
   ├─ Generate diff for each file
   └─ Return preview results

3. BACKUP (if enabled)
   ├─ Create timestamped backup folder
   ├─ Copy all source files
   └─ Save operation manifest

4. MIGRATE
   ├─ For each file:
   │   ├─ Read content
   │   ├─ Apply rules in priority order
   │   ├─ Rename file if needed
   │   └─ Write to output
   ├─ Update migration log
   └─ Clean empty directories

5. VERIFY
   ├─ Count processed files
   ├─ Report any errors
   └─ Update incremental state
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/scan` | 扫描源目录 |
| POST | `/api/preview` | Dry-run 预览 |
| POST | `/api/migrate` | 执行迁移 |
| POST | `/api/rollback` | 回滚操作 |
| GET | `/api/rules` | 获取规则列表 |
| POST | `/api/rules/custom` | 添加自定义规则 |
| GET | `/api/backups` | 获取备份列表 |
| WS | `/ws/progress` | 实时进度 |

## Frontend Pages

1. **Home** - 选择源目录和输出目录
2. **Rules** - 配置启用/禁用规则，添加自定义规则
3. **Preview** - 查看 Diff 预览
4. **Migrate** - 执行迁移，显示进度
5. **History** - 查看历史记录，支持回滚
