洛谷桌面客户端 · 免安装版
================================

双击本目录里的「启动洛谷.vbs」即可运行，不需要安装、不写注册表。
整个文件夹可以随便搬（U 盘、别的盘都行），双击 vbs 照常用，路径不限。

目录说明
  app\          程序本体
                  app\config.json   去广告开关（见下）
                  app\theme.css     配色
  electron\     运行时（约 350MB，删了就打不开）
  启动洛谷.vbs   启动器

第一次启动会在本目录生成「数据」文件夹（登录态、缓存、窗口位置都在这里）。
删掉它 = 退出登录 + 恢复默认设置。

去广告开关
  打开 app\config.json：
      { "hidePromos": true, "blockAds": true }
  hidePromos  隐藏站内推广位
  blockAds    拦截常见广告/统计域名
  改成 false 就关掉对应项，重启客户端生效。

快捷键
  Alt + ← / Alt + →   后退 / 前进
  F5、Ctrl + R        刷新
  F11 / Esc           进出全屏
  Alt + Shift + D     深色 / 浅色
  Ctrl + M / Ctrl + W 最小化 / 关闭

需要 Windows 10/11；磨砂效果需要 Windows 11。
本项目为非官方第三方客户端，与洛谷官方无关。
