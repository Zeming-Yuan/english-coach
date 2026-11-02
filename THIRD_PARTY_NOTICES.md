# 第三方组件声明

EnglishCoach 的自定义非商业许可证仅适用于项目权利人有权许可的原创内容。第三方代码、字体、图标及其修改部分仍适用各自许可证；项目许可证和商业授权不能替代、收紧或撤销这些第三方许可授予的权利。

## 核对范围与版本

以下是 **2026-11-02** 从开发环境实际安装文件核对的选定直接依赖和前端运行时组件快照，不是完整依赖清单、软件物料清单或法律合规结论。Python 版本来自本地 `.venv` 的包元数据，前端版本来自本地 `node_modules` 的包元数据；许可证及版权行按原文件逐字节保存于 `third_party/licenses/`。

`requirements.txt` 使用最低版本范围，并未锁定这些快照版本；前端声明也允许版本范围，实际安装或构建应结合锁文件核对。此处未覆盖全部传递依赖、`uvicorn[standard]` 的可选依赖或开发工具。再分发源码、安装包、容器或浏览器构建产物时，发布者须按实际包含的组件及版本重新盘点并履行相应条件。

## Python 运行时直接依赖

这些库通常由安装流程单独安装；列出声明不表示本仓库包含它们的全部源码或分发物。

| 组件及上游 | 本地快照版本 | 许可证及本地原文 |
| --- | --- | --- |
| [FastAPI](https://github.com/fastapi/fastapi) | 0.162.0 | [MIT](third_party/licenses/fastapi.LICENSE) |
| [Uvicorn](https://github.com/encode/uvicorn) | 0.54.0 | [BSD-3-Clause](third_party/licenses/uvicorn.LICENSE.md) |
| [SQLAlchemy](https://github.com/sqlalchemy/sqlalchemy) | 2.1.6 | [MIT](third_party/licenses/sqlalchemy.LICENSE)、[AUTHORS](third_party/licenses/sqlalchemy.AUTHORS) |
| [Alembic](https://github.com/sqlalchemy/alembic) | 1.20.1 | [MIT](third_party/licenses/alembic.LICENSE) |
| [pydantic-settings](https://github.com/pydantic/pydantic-settings) | 2.16.2 | [MIT](third_party/licenses/pydantic-settings.LICENSE) |
| [OpenAI Python SDK](https://github.com/openai/openai-python) | 3.41.0 | [Apache-2.0](third_party/licenses/openai.LICENSE) |
| [FSRS](https://github.com/open-spaced-repetition/py-fsrs) | 6.3.2 | [MIT](third_party/licenses/fsrs.LICENSE) |
| [edge-tts](https://github.com/rany2/edge-tts) | 7.3.1 | [LGPLv3；仅 `src/edge_tts/srt_composer.py` 使用 MIT](third_party/licenses/edge-tts.LICENSE)，另附 [GPLv3 正文](third_party/licenses/GPL-3.0.txt) |
| [tzdata](https://github.com/python/tzdata) | 未安装，未核对发行版本 | 上游 Python 包采用 [Apache-2.0](https://github.com/python/tzdata/blob/master/LICENSE)；其包含的时区数据及其他材料以实际发行物附带声明为准。本次未复制或验证已安装的 tzdata 许可文件。 |

### edge-tts 的 LGPL 条件

edge-tts 是单独安装的 LGPL 库。若分发该库、其修改版本或与之组合的分发物，应核对 LGPLv3 及其引用的 GPLv3 对应义务，包括适用的许可通知、对应源码提供方式、修改说明以及用户替换或修改该库的能力。项目自定义许可证不限制 LGPL 为调试库修改而允许的逆向工程，也不限制 LGPL 所保障的库替换权利。

本目录中的 edge-tts 原始许可文件包含 LGPLv3 正文及指定文件的 MIT 许可；GPLv3 配套正文逐字节取自本机 `/usr/share/common-licenses/GPL-3`。仅附上许可证副本并不等于已经满足所有再分发义务，应结合具体分发方式核对。

## 前端运行时、图标与字体

React、React DOM 及其 Scheduler 运行时可能进入浏览器构建产物。下表图标和字体是在开发环境中发现的可选组件；它们是否适用取决于实际源码及构建产物是否包含这些资源，不表示当前分支已声明或打包它们。

| 组件及上游 | 本地快照版本 | 许可证及本地原文 |
| --- | --- | --- |
| [React](https://github.com/facebook/react) | 19.2.8 | [MIT](third_party/licenses/react.LICENSE) |
| [React DOM](https://github.com/facebook/react) | 19.2.8 | [MIT](third_party/licenses/react-dom.LICENSE) |
| [Scheduler](https://github.com/facebook/react/tree/main/packages/scheduler) | 0.27.0 | [MIT](third_party/licenses/scheduler.LICENSE) |
| [Phosphor Icons React](https://github.com/phosphor-icons/react)（包含时） | 2.1.10 | [MIT](third_party/licenses/phosphor-icons-react.LICENSE) |
| [Noto Sans SC](https://github.com/notofonts/noto-cjk) / [Fontsource 包](https://fontsource.org/fonts/noto-sans-sc)（包含时） | `@fontsource-variable/noto-sans-sc` 5.3.1 | [SIL Open Font License 1.1](third_party/licenses/noto-sans-sc.LICENSE) |
| [Tinos](https://github.com/googlefonts/tinos) / [Fontsource 包](https://fontsource.org/fonts/tinos)（包含时） | `@fontsource/tinos` 5.3.0 | [SIL Open Font License 1.1](third_party/licenses/tinos.LICENSE) |

字体的 OFL 条款独立适用，包括保留许可及版权声明、保留字体名称相关限制和字体不得单独出售等条件。发布前端资源时，应随分发物保留相应第三方声明和许可文本。

## 外部服务

edge-tts 所访问的在线语音服务及 AI 服务是外部服务。客户端库的许可证不授予服务访问权，也不代替服务提供方的使用条款、账户要求或内容使用条件；项目商业授权同样不代替这些条件。
