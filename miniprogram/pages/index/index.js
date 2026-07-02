const app = getApp();

Page({
  data: {
    currentDate: '',
    isAnalyzing: false,
    todayStats: {
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0
    },
    mealRecords: [],
    mealText: '',
    showEditModal: false,
    editingRecordId: '',
    editingMeal: {
      foodName: '',
      calories: '',
      protein: '',
      fat: '',
      carbs: ''
    }
  },

  onInputMeal(e) {
    this.setData({ mealText: e.detail.value });
  },

  extractJsonObject(content) {
    const cleaned = String(content || '')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error('返回内容格式异常');
      }
      return JSON.parse(match[0]);
    }
  },

  normalizeMealData(data) {
    return {
      foodName: String(data.foodName || data.name || '未知食物').slice(0, 60),
      calories: this.toNumber(data.calories),
      protein: this.toNumber(data.protein),
      fat: this.toNumber(data.fat),
      carbs: this.toNumber(data.carbs)
    };
  },

  async callMealFunction(type, data = {}) {
    await app.cloudInitPromise;
    const res = await app.cloud.callFunction({
      name: 'quickstartFunctions',
      data: {
        type,
        ...data
      }
    });

    if (!res.result || !res.result.success) {
      const error = new Error((res.result && res.result.errMsg) || '云函数调用失败');
      error.code = res.result && res.result.errCode || '';
      console.error('云函数调用失败', type, res.result);
      throw error;
    }

    return res.result.data;
  },

  isContentRiskError(e) {
    return e && (e.code === 'CONTENT_SECURITY_RISK' || e.message === '内容含违规信息');
  },

  showContentErrorOrFallback(e, fallback) {
    wx.showToast({
      title: this.isContentRiskError(e) ? '内容含违规信息' : fallback,
      icon: 'none'
    });
  },

  async submitMealText() {
    if (this.data.isAnalyzing) return;

    const text = this.data.mealText.trim();
    if (!text) {
      wx.showToast({ title: '请输入食物内容', icon: 'none' });
      return;
    }
    
    this.setData({ isAnalyzing: true });
    wx.showLoading({ title: '估算中...', mask: true });
    
    try {
      await app.cloudInitPromise;
      // 使用共享环境的 cloud 实例来做文字估算
      const ai = app.cloud.extend.AI;
      const model = ai.createModel("hunyuan-exp");
      
      const res = await model.generateText({
        model: "hunyuan-2.0-instruct-20251111",
        messages: [
          {
            role: "user",
            content: `请分析以下食物内容。估算其热量（千卡）、蛋白质（克）、脂肪（克）、碳水化合物（克）以及提取食物名称。请只返回一个JSON对象，不要输出其他多余的解释。格式如下：{"foodName":"米饭","calories":200,"protein":5,"fat":1,"carbs":40}\n\n食物内容：${text}`
          }
        ]
      });
      
      let aiResponse = res.choices[0].message.content;
      console.log('Estimate Response:', aiResponse);
      const resultData = this.normalizeMealData(this.extractJsonObject(aiResponse));
      
      if (resultData && resultData.foodName) {
        await this.callMealFunction('createMealRecord', {
          data: {
            date: this.getTodayDateString(),
            imageUrl: '',
            foodName: resultData.foodName,
            calories: resultData.calories || 0,
            protein: resultData.protein || 0,
            fat: resultData.fat || 0,
            carbs: resultData.carbs || 0,
            originalText: text
          }
        });
        
        wx.showToast({ title: '记录成功', icon: 'success' });
        this.setData({ mealText: '' });
        this.fetchTodayRecords();
      } else {
        wx.showToast({ title: '估算失败', icon: 'none' });
      }
      
    } catch (e) {
      console.error('文本估算报错', e);
      this.showContentErrorOrFallback(e, '估算失败');
    } finally {
      this.setData({ isAnalyzing: false });
      wx.hideLoading();
    }
  },

  onLoad() {
    this.setData({
      currentDate: this.getDisplayDate()
    });
  },

  onShow() {
    this.fetchTodayRecords();
  },

  async fetchTodayRecords() {
    const today = this.getTodayDateString();
    try {
      const data = await this.callMealFunction('listMealRecords', {
        date: today
      });
      
      const records = await this.prepareMealRecords(data || []);
      let totalCalories = 0;
      let totalProtein = 0;
      let totalFat = 0;
      let totalCarbs = 0;
      
      records.forEach(record => {
        totalCalories += record.calories || 0;
        totalProtein += record.protein || 0;
        totalFat += record.fat || 0;
        totalCarbs += record.carbs || 0;
      });
      
      this.setData({
        mealRecords: records,
        todayStats: {
          calories: totalCalories,
          protein: totalProtein,
          fat: totalFat,
          carbs: totalCarbs
        }
      });
    } catch (e) {
      console.error('获取记录失败', e);
    }
  },

  async prepareMealRecords(records) {
    const fileIDs = records
      .map(record => record.imageFileID || record.fileID)
      .filter(Boolean);
    const imageUrlMap = {};

    if (fileIDs.length > 0) {
      try {
        const urlRes = await app.cloud.getTempFileURL({
          fileList: fileIDs
        });
        (urlRes.fileList || []).forEach(file => {
          imageUrlMap[file.fileID] = file.tempFileURL;
        });
      } catch (e) {
        console.error('获取餐食图片链接失败', e);
      }
    }

    return records.map(record => {
      const imageFileID = record.imageFileID || record.fileID || '';
      return {
      ...record,
      displayImage: imageUrlMap[imageFileID] || imageFileID || record.imageUrl || '',
      imageLoadFailed: false
      };
    });
  },

  getTodayDateString() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },

  getDisplayDate() {
    const date = new Date();
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  },

  toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
  },

  noop() {},

  openEditMeal(e) {
    const index = e.currentTarget.dataset.index;
    const record = this.data.mealRecords[index];
    if (!record) return;

    this.setData({
      showEditModal: true,
      editingRecordId: record._id,
      editingMeal: {
        foodName: record.foodName || '',
        calories: String(record.calories || 0),
        protein: String(record.protein || 0),
        fat: String(record.fat || 0),
        carbs: String(record.carbs || 0)
      }
    });
  },

  closeEditMeal() {
    this.setData({
      showEditModal: false,
      editingRecordId: '',
      editingMeal: {
        foodName: '',
        calories: '',
        protein: '',
        fat: '',
        carbs: ''
      }
    });
  },

  onEditMealInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;

    this.setData({
      [`editingMeal.${field}`]: e.detail.value
    });
  },

  onRecordImageError(e) {
    const index = e.currentTarget.dataset.index;
    if (index === undefined) return;

    this.setData({
      [`mealRecords[${index}].imageLoadFailed`]: true
    });
  },

  async saveEditedMeal() {
    const id = this.data.editingRecordId;
    const meal = this.data.editingMeal;
    const foodName = meal.foodName.trim();

    if (!id || !foodName) {
      wx.showToast({ title: '请填写食物名称', icon: 'none' });
      return;
    }

    try {
      await app.cloudInitPromise;
      await this.callMealFunction('updateMealRecord', {
        id,
        data: {
          foodName,
          calories: this.toNumber(meal.calories),
          protein: this.toNumber(meal.protein),
          fat: this.toNumber(meal.fat),
          carbs: this.toNumber(meal.carbs)
        }
      });

      wx.showToast({ title: '已保存', icon: 'success' });
      this.closeEditMeal();
      this.fetchTodayRecords();
    } catch (e) {
      console.error('更新餐食失败', e);
      this.showContentErrorOrFallback(e, '保存失败');
    }
  },

  deleteEditedMeal() {
    const id = this.data.editingRecordId;
    if (!id) return;

    wx.showModal({
      title: '删除这餐？',
      content: '删除后今日统计会同步更新。',
      confirmText: '删除',
      confirmColor: '#E5484D',
      success: async (res) => {
        if (!res.confirm) return;

        try {
          await app.cloudInitPromise;
          await this.callMealFunction('deleteMealRecord', { id });

          wx.showToast({ title: '已删除', icon: 'success' });
          this.closeEditMeal();
          this.fetchTodayRecords();
        } catch (e) {
          console.error('删除餐食失败', e);
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },

  async takePhoto() {
    if (this.data.isAnalyzing) return;

    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed']
      });
      
      if (res.tempFiles && res.tempFiles.length > 0) {
        const tempFilePath = await this.compressImage(res.tempFiles[0].tempFilePath);
        this.uploadAndAnalyze(tempFilePath);
      }
    } catch (e) {
      console.error('取消选择照片或出错', e);
    }
  },

  compressImage(filePath) {
    return new Promise((resolve) => {
      if (!wx.compressImage) {
        resolve(filePath);
        return;
      }

      wx.compressImage({
        src: filePath,
        quality: 72,
        success: res => resolve(res.tempFilePath || filePath),
        fail: () => resolve(filePath)
      });
    });
  },

  async uploadAndAnalyze(tempFilePath) {
    this.setData({ isAnalyzing: true });
    wx.showLoading({ title: '识别中...', mask: true });
    let uploadedFileID = '';
    let savedRecord = false;
    
    try {
      await app.cloudInitPromise;
      
      // 1. 上传到云存储
      // 使用随机字符串生成云端文件名
      const randomStr = Math.random().toString(36).substring(2, 8);
      const extMatch = tempFilePath.match(/\.[^.]+?$/);
      const ext = extMatch ? extMatch[0] : '.jpg';
      const cloudPath = `meals/meal_${Date.now()}_${randomStr}${ext}`;
      const uploadRes = await app.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
      });
      const fileID = uploadRes.fileID;
      uploadedFileID = fileID;
      
      // 2. 获取临时访问链接 (HTTPS url) 以供识别接口访问
      const urlRes = await app.cloud.getTempFileURL({
        fileList: [fileID]
      });
      const imageUrl = urlRes.fileList[0].tempFileURL;
      
      // 3. 调用云函数分析图片，避免在小程序端暴露接口密钥
      const result = await this.analyzeImage(imageUrl);
      
      if (result) {
        // 4. 保存到数据库
        await this.callMealFunction('createMealRecord', {
          data: {
            date: this.getTodayDateString(),
            imageFileID: fileID,
            imageUrl: imageUrl,
            foodName: result.foodName || '未知食物',
            calories: result.calories || 0,
            protein: result.protein || 0,
            fat: result.fat || 0,
            carbs: result.carbs || 0
          }
        });
        savedRecord = true;
        
        wx.showToast({ title: '记录成功', icon: 'success' });
        this.fetchTodayRecords();
      } else {
        wx.showToast({ title: '识别失败', icon: 'none' });
      }
      
    } catch (e) {
      console.error('上传或分析失败', e);
      if (uploadedFileID && !savedRecord) {
        app.cloud.deleteFile({
          fileList: [uploadedFileID]
        }).catch(err => console.error('清理图片失败', err));
      }
      this.showContentErrorOrFallback(e, '处理失败');
    } finally {
      this.setData({ isAnalyzing: false });
      wx.hideLoading();
    }
  },

  async analyzeImage(imageUrl) {
    try {
      await app.cloudInitPromise;

      const res = await app.cloud.callFunction({
        name: 'quickstartFunctions',
        data: {
          type: 'analyzeImage',
          imageUrl
        }
      });

      if (!res.result || !res.result.success) {
        console.error('云函数分析失败', res.result);
        return null;
      }

      return res.result.data;
    } catch (e) {
      console.error('识别接口调用失败', e);
      return null;
    }
  }
});
