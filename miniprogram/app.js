// app.js
App({
  onLaunch: function () {
    this.globalData = {
      // 请在这里填写你资源方的小程序 AppID 和共享的环境 ID
      // resourceAppid: "资源方小程序的AppID",
      // resourceEnv: "资源方共享的环境ID",
    };
    
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      // 1. 本地小程序的原生云开发初始化（如果不执行这个，直接使用 wx.cloud.extend.AI 会报未初始化）
      // 注意：这里需要传入你当前小程序的云环境ID，哪怕你主要是借用别人的，如果用到自己名下的Token或组件也必须init一下
      wx.cloud.init({
        // 如果你在这个小程序名下创建过云环境，请填入环境ID。
        // 如果没有，留空 {} 或只放 traceUser 也行，只要调用了 init() 就不会报 "-1" 了
        traceUser: true,
      });

      // 2. 声明新的 cloud 实例用于跨账号调用（用于数据库、云存储等读写共享资源）
      this.cloud = new wx.cloud.Cloud({
        // 🚨非常重要：此处必须替换为提供资源的小程序的真实 AppID 和 环境ID
        resourceAppid: 'wxc673a616985418b7', 
        resourceEnv: 'cloud1-0gfi50rxec17356d',   
      });
      
      // 添加这个 Promise 供页面等待
      this.cloudInitPromise = this.cloud.init().then(() => {
        console.log("共享云环境初始化成功");
      }).catch(err => {
        console.error("共享云环境初始化失败", err);
        throw err;
      });
    }
  },
});
