# 飞书治具查询机器人部署说明

目标：

在飞书群里 @自建应用机器人，输入治具编码、厂商或治具名称，机器人实时读取飞书云文档并回复交期信息。

## 1. 部署到 Vercel

1. 把本文件夹上传到一个新的 GitHub 仓库。
2. 打开 Vercel，选择 `Add New Project`。
3. 导入这个 GitHub 仓库。
4. Framework Preset 选 `Other`。
5. 部署完成后会得到一个地址，例如：

```text
https://your-project.vercel.app
```

事件订阅地址就是：

```text
https://your-project.vercel.app/api/feishu/events
```

## 2. 在 Vercel 配置环境变量

进入 Vercel 项目：

```text
Settings -> Environment Variables
```

新增：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_WIKI_NODE_TOKEN
FEISHU_SPREADSHEET_TOKEN
FEISHU_SHEET_RANGES
FEISHU_VERIFICATION_TOKEN
```

说明：

- `FEISHU_APP_ID`：飞书自建应用 App ID。
- `FEISHU_APP_SECRET`：飞书自建应用 App Secret。
- `FEISHU_WIKI_NODE_TOKEN`：Wiki 链接里的 token，例如 `/wiki/BxS...` 中的 `BxS...`。
- `FEISHU_SPREADSHEET_TOKEN`：如果你直接使用普通表格 token，就填这个；如果用 Wiki 节点，可以不填。
- `FEISHU_SHEET_RANGES`：建议填 `ALL`。
- `FEISHU_VERIFICATION_TOKEN`：飞书事件订阅里的 Verification Token。

## 3. 飞书开放平台配置

进入飞书开放平台的自建应用。

### 权限管理

至少需要：

```text
im:message
im:message:send_as_bot
im:message:readonly
wiki:node:read
wiki:node:retrieve
wiki:space:read
sheets:spreadsheet:readonly
sheets:spreadsheet.value:readonly
```

如果权限名称不同，就搜索：

```text
机器人发送消息
读取消息
读取电子表格
查看知识库节点
```

添加权限后，一定要发布新版本。

### 事件订阅

1. 打开：

```text
事件与回调 -> 事件订阅
```

2. 请求地址填：

```text
https://your-project.vercel.app/api/feishu/events
```

3. Verification Token 填到 Vercel 的 `FEISHU_VERIFICATION_TOKEN`。
4. 订阅事件：

```text
接收消息 im.message.receive_v1
```

5. 保存。

### 机器人能力

打开应用的机器人能力，并把应用发布/安装到企业。

## 4. 添加机器人到群

在飞书群里：

```text
群设置 -> 群机器人/添加应用 -> 搜索你的自建应用 -> 添加
```

然后测试：

```text
@治具机器人 RD3SA0000009
@治具机器人 万德锢
@治具机器人 UV灯治具
```

## 5. 注意

这个机器人每次被 @ 时都会实时读取飞书云文档，所以云文档更新后，不需要重新下载 Excel。

如果数据量继续增大，查询可能变慢。后续可以加 3-5 分钟缓存。
