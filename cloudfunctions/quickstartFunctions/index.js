const cloud = require("wx-server-sdk");
const https = require("https");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const DASHSCOPE_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEFAULT_VISION_MODEL = "qwen3.5-omni-flash";

const postJson = (url, data, headers = {}) => {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (e) {
          reject(new Error(`API 返回非 JSON 内容：${body.slice(0, 200)}`));
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`API 请求失败 ${res.statusCode}：${JSON.stringify(parsed).slice(0, 300)}`));
          return;
        }

        resolve(parsed);
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("API 请求超时"));
    });
    req.on("error", reject);
    req.write(JSON.stringify(data));
    req.end();
  });
};

const downloadImage = (url, maxBytes = 2 * 1024 * 1024) => {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const contentType = res.headers["content-type"] || "image/jpeg";
      const chunks = [];
      let total = 0;

      res.on("data", chunk => {
        total += chunk.length;
        if (total > maxBytes) {
          req.destroy(new Error("图片过大，请重新上传"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`图片下载失败 ${res.statusCode}`));
          return;
        }
        resolve({
          contentType,
          buffer: Buffer.concat(chunks),
        });
      });
    });

    req.setTimeout(20000, () => {
      req.destroy(new Error("图片下载超时"));
    });
    req.on("error", reject);
  });
};

const extractJsonObject = (content) => {
  if (!content) {
    throw new Error("返回内容为空");
  }

  if (typeof content === "object") {
    return content;
  }

  const cleaned = String(content)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`未找到 JSON 对象：${cleaned.slice(0, 200)}`);
    }
    return JSON.parse(match[0]);
  }
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
};

const normalizeMealAnalysis = (data) => {
  return {
    foodName: String(data.foodName || data.name || "未知食物").slice(0, 60),
    calories: toNumber(data.calories),
    protein: toNumber(data.protein),
    fat: toNumber(data.fat),
    carbs: toNumber(data.carbs),
  };
};

const CONTENT_SECURITY_ERR = "CONTENT_SECURITY_RISK";

const createSecurityError = () => {
  const error = new Error("内容含违规信息");
  error.code = CONTENT_SECURITY_ERR;
  return error;
};

const getOwnerId = () => {
  const wxContext = cloud.getWXContext();
  return wxContext.OPENID || wxContext.FROM_OPENID || "";
};

const getDateString = (date = new Date()) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const sanitizeMealRecord = (record = {}) => {
  return {
    date: String(record.date || getDateString()).slice(0, 10),
    imageFileID: String(record.imageFileID || record.fileID || ""),
    imageUrl: String(record.imageUrl || ""),
    foodName: String(record.foodName || "未知食物").trim().slice(0, 60),
    calories: toNumber(record.calories),
    protein: toNumber(record.protein),
    fat: toNumber(record.fat),
    carbs: toNumber(record.carbs),
    originalText: String(record.originalText || "").slice(0, 500),
  };
};

const sanitizeGoal = (goal = {}) => {
  return {
    calories: toNumber(goal.calories) || 1800,
    protein: toNumber(goal.protein) || 90,
    fat: toNumber(goal.fat) || 55,
    carbs: toNumber(goal.carbs) || 220,
  };
};

const checkTextContent = async (content, ownerId) => {
  const text = String(content || "").trim();
  if (!text) return;

  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: text.slice(0, 2500),
    });

    const suggest = res && res.result && res.result.suggest;
    if (suggest && suggest !== "pass" || res && res.errCode === 87014) {
      throw createSecurityError();
    }
  } catch (e) {
    if (e.code === CONTENT_SECURITY_ERR || e.errCode === 87014) {
      throw createSecurityError();
    }
    console.warn("内容安全检测暂不可用，已跳过本次校验", e);
  }
};

const checkImageContent = async (imageUrl) => {
  const url = String(imageUrl || "").trim();
  if (!url) return;

  try {
    const image = await downloadImage(url);
    await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: image.contentType,
        value: image.buffer,
      }
    });
  } catch (e) {
    if (e.code === CONTENT_SECURITY_ERR || e.errCode === 87014) {
      throw createSecurityError();
    }
    console.warn("图片安全检测暂不可用，已跳过本次校验", e);
  }
};

const checkMealTextFields = async (meal, ownerId) => {
  await checkTextContent(meal.foodName, ownerId);
  await checkTextContent(meal.originalText, ownerId);
};

const belongsToOwner = (record, ownerId) => {
  return record && (record.ownerId === ownerId || record._openid === ownerId);
};

const uniqueById = (records = []) => {
  const map = {};
  records.forEach(record => {
    if (record && record._id) {
      map[record._id] = record;
    }
  });
  return Object.values(map);
};

const getOwnerSettings = async (ownerId) => {
  const collection = db.collection("user_settings");
  const byOwner = await collection.where({ ownerId }).limit(1).get();
  if (byOwner.data && byOwner.data[0]) return byOwner.data[0];

  const byOpenId = await collection.where({ _openid: ownerId }).limit(1).get();
  return byOpenId.data && byOpenId.data[0] ? byOpenId.data[0] : null;
};

const listOwnerMealsByDate = async (ownerId, date) => {
  const collection = db.collection("calories");
  const byOwner = await collection.where({ ownerId, date }).orderBy("createTime", "desc").limit(100).get();
  const byOpenId = await collection.where({ _openid: ownerId, date }).orderBy("createTime", "desc").limit(100).get();
  return uniqueById([...(byOwner.data || []), ...(byOpenId.data || [])])
    .sort((a, b) => {
      const aTime = a.createTime && (a.createTime.getTime ? a.createTime.getTime() : new Date(a.createTime).getTime()) || 0;
      const bTime = b.createTime && (b.createTime.getTime ? b.createTime.getTime() : new Date(b.createTime).getTime()) || 0;
      return bTime - aTime;
    });
};

const listOwnerMealsInRange = async (ownerId, startDate, endDate, limit = 300) => {
  const _ = db.command;
  const collection = db.collection("calories");
  const dateRange = _.gte(startDate).and(_.lte(endDate));
  const byOwner = await collection.where({ ownerId, date: dateRange }).limit(limit).get();
  const byOpenId = await collection.where({ _openid: ownerId, date: dateRange }).limit(limit).get();
  return uniqueById([...(byOwner.data || []), ...(byOpenId.data || [])]);
};

const createMealRecord = async (event) => {
  try {
    const ownerId = getOwnerId();
    if (!ownerId) throw new Error("无法获取用户身份");

    const meal = sanitizeMealRecord(event.data || event.record || {});
    if (!meal.foodName) throw new Error("缺少食物名称");
    await checkMealTextFields(meal, ownerId);
    await checkImageContent(meal.imageUrl);

    const res = await db.collection("calories").add({
      data: {
        ...meal,
        ownerId,
        createTime: db.serverDate(),
        updateTime: db.serverDate(),
      }
    });

    return { success: true, data: { _id: res._id } };
  } catch (e) {
    console.error("创建餐食失败", e);
    return { success: false, errCode: e.code || "", errMsg: e.message || String(e) };
  }
};

const listMealRecords = async (event) => {
  try {
    const ownerId = getOwnerId();
    if (!ownerId) throw new Error("无法获取用户身份");

    const date = String(event.date || getDateString()).slice(0, 10);
    return {
      success: true,
      data: await listOwnerMealsByDate(ownerId, date)
    };
  } catch (e) {
    console.error("查询餐食失败", e);
    return { success: false, errMsg: e.message || String(e) };
  }
};

const updateMealRecord = async (event) => {
  try {
    const ownerId = getOwnerId();
    const id = event.id || event._id;
    if (!ownerId) throw new Error("无法获取用户身份");
    if (!id) throw new Error("缺少记录 ID");

    const current = await db.collection("calories").doc(id).get();
    const record = current.data;
    if (!belongsToOwner(record, ownerId)) throw new Error("无权修改该记录");

    const meal = sanitizeMealRecord({ ...record, ...(event.data || {}) });
    await checkTextContent(meal.foodName, ownerId);
    await db.collection("calories").doc(id).update({
      data: {
        foodName: meal.foodName,
        calories: meal.calories,
        protein: meal.protein,
        fat: meal.fat,
        carbs: meal.carbs,
        updateTime: db.serverDate(),
      }
    });

    return { success: true };
  } catch (e) {
    console.error("更新餐食失败", e);
    return { success: false, errCode: e.code || "", errMsg: e.message || String(e) };
  }
};

const deleteMealRecord = async (event) => {
  try {
    const ownerId = getOwnerId();
    const id = event.id || event._id;
    if (!ownerId) throw new Error("无法获取用户身份");
    if (!id) throw new Error("缺少记录 ID");

    const current = await db.collection("calories").doc(id).get();
    const record = current.data;
    if (!belongsToOwner(record, ownerId)) throw new Error("无权删除该记录");

    await db.collection("calories").doc(id).remove();
    return { success: true };
  } catch (e) {
    console.error("删除餐食失败", e);
    return { success: false, errMsg: e.message || String(e) };
  }
};

const getUserSettings = async () => {
  try {
    const ownerId = getOwnerId();
    if (!ownerId) throw new Error("无法获取用户身份");

    const setting = await getOwnerSettings(ownerId);
    return {
      success: true,
      data: setting || sanitizeGoal()
    };
  } catch (e) {
    console.error("获取设置失败", e);
    return { success: false, errMsg: e.message || String(e), data: sanitizeGoal() };
  }
};

const saveUserSettings = async (event) => {
  try {
    const ownerId = getOwnerId();
    if (!ownerId) throw new Error("无法获取用户身份");

    const goal = sanitizeGoal(event.data || event.goal || {});
    const collection = db.collection("user_settings");
    const existing = await getOwnerSettings(ownerId);

    if (existing) {
      await collection.doc(existing._id).update({
        data: {
          ...goal,
          ownerId,
          updateTime: db.serverDate(),
        }
      });
      return { success: true, data: { _id: existing._id, ...goal } };
    }

    const res = await collection.add({
      data: {
        ...goal,
        ownerId,
        createTime: db.serverDate(),
        updateTime: db.serverDate(),
      }
    });
    return { success: true, data: { _id: res._id, ...goal } };
  } catch (e) {
    console.error("保存设置失败", e);
    return { success: false, errMsg: e.message || String(e) };
  }
};

const getReport = async (event) => {
  try {
    const ownerId = getOwnerId();
    if (!ownerId) throw new Error("无法获取用户身份");

    const dayCount = Math.min(Math.max(toNumber(event.days) || 7, 1), 30);
    const today = new Date();
    const days = [];
    for (let i = dayCount - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      days.push({
        date: getDateString(date),
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        records: 0,
        percent: 0,
      });
    }

    const settings = await getUserSettings();
    const goal = sanitizeGoal(settings.data);
    const records = await listOwnerMealsInRange(ownerId, days[0].date, days[days.length - 1].date, 300);

    const map = {};
    days.forEach(day => {
      map[day.date] = day;
    });

    records.forEach(record => {
        const day = map[record.date];
        if (!day) return;
        day.calories += record.calories || 0;
        day.protein += record.protein || 0;
        day.fat += record.fat || 0;
        day.carbs += record.carbs || 0;
        day.records += 1;
    });

    let totalCalories = 0;
    let totalRecords = 0;
    days.forEach(day => {
      day.calories = Math.round(day.calories);
      day.protein = Math.round(day.protein);
      day.fat = Math.round(day.fat);
      day.carbs = Math.round(day.carbs);
      day.percent = goal.calories ? Math.min(100, Math.round(day.calories / goal.calories * 100)) : 0;
      totalCalories += day.calories;
      totalRecords += day.records;
    });

    const trackedDays = days.filter(day => day.records > 0).length;
    return {
      success: true,
      data: {
        days,
        goal,
        summary: {
          totalCalories,
          avgCalories: trackedDays ? Math.round(totalCalories / trackedDays) : 0,
          totalRecords,
          trackedDays,
        }
      }
    };
  } catch (e) {
    console.error("获取报表失败", e);
    return { success: false, errMsg: e.message || String(e) };
  }
};

const getProfileStats = async () => {
  try {
    const ownerId = getOwnerId();
    if (!ownerId) throw new Error("无法获取用户身份");

    const userRecords = await listOwnerMealsInRange(ownerId, "1970-01-01", "2999-12-31", 1000);
    const dateSet = {};
    userRecords.forEach(record => {
      if (record.date) dateSet[record.date] = true;
    });

    return {
      success: true,
      data: {
        totalRecords: userRecords.length,
        totalDays: Object.keys(dateSet).length,
      }
    };
  } catch (e) {
    console.error("获取个人统计失败", e);
    return { success: false, errMsg: e.message || String(e) };
  }
};

const checkTextContentForClient = async (event) => {
  try {
    const ownerId = getOwnerId();
    if (!ownerId) throw new Error("无法获取用户身份");

    await checkTextContent(event.content, ownerId);
    return { success: true };
  } catch (e) {
    console.error("文本内容检测失败", e);
    return {
      success: false,
      errCode: e.code || "",
      errMsg: e.message || String(e)
    };
  }
};

const checkImageContentForClient = async (event) => {
  try {
    await checkImageContent(event.imageUrl);
    return { success: true };
  } catch (e) {
    console.error("图片内容检测失败", e);
    return {
      success: false,
      errCode: e.code || "",
      errMsg: e.message || String(e)
    };
  }
};

// 获取openid
const getOpenId = async () => {
  // 获取基础信息
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID || wxContext.FROM_OPENID,
    appid: wxContext.APPID || wxContext.FROM_APPID,
    unionid: wxContext.UNIONID || wxContext.FROM_UNIONID,
  };
};

// 获取小程序二维码
const getMiniProgramCode = async () => {
  // 获取小程序二维码的buffer
  const resp = await cloud.openapi.wxacode.get({
    path: "pages/index/index",
  });
  const { buffer } = resp;
  // 将图片上传云存储空间
  const upload = await cloud.uploadFile({
    cloudPath: "code.png",
    fileContent: buffer,
  });
  return upload.fileID;
};

// 创建集合
const createCollection = async () => {
  try {
    // 创建集合
    await db.createCollection("sales");
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华东",
        city: "上海",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华东",
        city: "南京",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华南",
        city: "广州",
        sales: 22,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华南",
        city: "深圳",
        sales: 22,
      },
    });
    return {
      success: true,
    };
  } catch (e) {
    // 这里catch到的是该collection已经存在，从业务逻辑上来说是运行成功的，所以catch返回success给前端，避免工具在前端抛出异常
    return {
      success: true,
      data: "create collection success",
    };
  }
};

// 查询数据
const selectRecord = async () => {
  // 返回数据库查询结果
  return await db.collection("sales").get();
};

// 更新数据
const updateRecord = async (event) => {
  try {
    // 遍历修改数据库信息
    for (let i = 0; i < event.data.length; i++) {
      await db
        .collection("sales")
        .where({
          _id: event.data[i]._id,
        })
        .update({
          data: {
            sales: event.data[i].sales,
          },
        });
    }
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 新增数据
const insertRecord = async (event) => {
  try {
    const insertRecord = event.data;
    // 插入数据
    await db.collection("sales").add({
      data: {
        region: insertRecord.region,
        city: insertRecord.city,
        sales: Number(insertRecord.sales),
      },
    });
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 删除数据
const deleteRecord = async (event) => {
  try {
    await db
      .collection("sales")
      .where({
        _id: event.data._id,
      })
      .remove();
    return {
      success: true,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 分析图片热量
const analyzeImage = async (event) => {
  try {
    if (!event.imageUrl) {
      throw new Error("缺少 imageUrl");
    }

    const apiKey = process.env.DASHSCOPE_API_KEY || process.env.ALI_AI_API_KEY || process.env.BAILIAN_API_KEY;
    if (!apiKey) {
      throw new Error("未配置 DASHSCOPE_API_KEY 云函数环境变量");
    }

    const res = await postJson(DASHSCOPE_API_URL, {
      model: process.env.ALI_VISION_MODEL || DEFAULT_VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请识别图片中的餐食，并估算整张图片中可食用部分的营养总量。只返回一个 JSON 对象，不要输出 Markdown 或解释。字段必须是：foodName, calories, protein, fat, carbs。calories 单位是千卡，protein/fat/carbs 单位是克。示例：{\"foodName\":\"米饭和红烧肉\",\"calories\":650,\"protein\":28,\"fat\":24,\"carbs\":82}"
            },
            {
              type: "image_url",
              image_url: {
                url: event.imageUrl
              }
            }
          ]
        }
      ]
    }, {
      Authorization: `Bearer ${apiKey}`,
    });

    const aiResponse = res.choices && res.choices[0] && res.choices[0].message
      ? res.choices[0].message.content
      : "";
    console.log('Recognition Response:', aiResponse);

    const resultData = normalizeMealAnalysis(extractJsonObject(aiResponse));
    return {
      success: true,
      data: resultData
    };
  } catch (e) {
    console.error('识别接口调用失败', e);
    return {
      success: false,
      errMsg: e.message || String(e)
    };
  }
};

// const getOpenId = require('./getOpenId/index');
// const getMiniProgramCode = require('./getMiniProgramCode/index');
// const createCollection = require('./createCollection/index');
// const selectRecord = require('./selectRecord/index');
// const updateRecord = require('./updateRecord/index');
// const fetchGoodsList = require('./fetchGoodsList/index');
// const genMpQrcode = require('./genMpQrcode/index');
// 云函数入口函数
exports.main = async (event, context) => {
  switch (event.type) {
    case "getOpenId":
      return await getOpenId();
    case "getMiniProgramCode":
      return await getMiniProgramCode();
    case "createCollection":
      return await createCollection();
    case "selectRecord":
      return await selectRecord();
    case "updateRecord":
      return await updateRecord(event);
    case "insertRecord":
      return await insertRecord(event);
    case "deleteRecord":
      return await deleteRecord(event);
    case "analyzeImage":
      return await analyzeImage(event);
    case "createMealRecord":
      return await createMealRecord(event);
    case "listMealRecords":
      return await listMealRecords(event);
    case "updateMealRecord":
      return await updateMealRecord(event);
    case "deleteMealRecord":
      return await deleteMealRecord(event);
    case "getUserSettings":
      return await getUserSettings(event);
    case "saveUserSettings":
      return await saveUserSettings(event);
    case "getReport":
      return await getReport(event);
    case "getProfileStats":
      return await getProfileStats(event);
    case "checkTextContent":
      return await checkTextContentForClient(event);
    case "checkImageContent":
      return await checkImageContentForClient(event);
  }
};
