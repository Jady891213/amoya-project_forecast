# output

本目录统一存放可重新生成的输出，不提交具体构建文件：

- `web/`：正式前端构建，由本地服务托管。
- `legacy-singlefile/`：按需生成的兼容单 HTML。
- `test/`：浏览器或测试输出。

正式构建：在 `src` 中执行 `pnpm build`。
