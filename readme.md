# 如何使用?
直接点击"启动演示"
# 作品简介
本作品为《学讯聚合》课程演示系统，面向大学生多渠道校园通知分散、噪音多的痛点。前端模拟微信、QQ、学习通、邮件与短信五类来源，支持按来源与时间筛选、本地增删改通知；后端以 FastAPI 加载本地 Qwen2-1.5B-Instruct，实现通知智能摘要与多轮对话。用户可预览定时推送并在模拟微信会话中查看摘要短信与 AI 问答，体现“聚合→精炼→推送”闭环
# 作品运行环境
1. 操作系统
Windows 10/11（64 位）；通过双击启动演示.bat 启动，无需配置环境
2. 硬件
内存 ≥ 8GB；磁盘预留约 4GB（含 Qwen2-1.5B-Instruct 模型权重）
3. 运行环境
Python 3.8 及以上（需加入系统 PATH）；首次运行由脚本自动执行 pip install -r backend/requirements.txt 安装依赖
4. 主要依赖
PyTorch、Transformers、FastAPI、Uvicorn、Pydantic 等（见 backend/requirements.txt）
5. 大语言模型
Qwen2-1.5B-Instruct；优先加载项目内 models/Qwen2-1.5B-Instruct，若无本地权重且联网则从 HuggingFace Hub 下载（约 3GB）
6. 网络
仅演示页面与本地 API 可不联网；首次下载模型或安装 pip 包时需联网
# 效果展示
<img width="1093" height="642" alt="image" src="https://github.com/user-attachments/assets/c22e3073-6cd1-41a0-ae2b-740583c1538b" />
<img width="1106" height="645" alt="image" src="https://github.com/user-attachments/assets/213a7f1c-4937-4d81-84bc-173ffc81b51c" />
<img width="1106" height="641" alt="image" src="https://github.com/user-attachments/assets/8ab7941c-867c-4d9d-a591-45543773b21c" />
<img width="1106" height="642" alt="image" src="https://github.com/user-attachments/assets/9f3a28d6-2d0d-4b0e-ab83-93b3f634efbf" />
<img width="1106" height="639" alt="image" src="https://github.com/user-attachments/assets/cb52cafa-43b8-40a5-b4b0-7d349b7d25c4" />







