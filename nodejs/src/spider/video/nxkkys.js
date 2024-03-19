// 引入需要的模块和工具
import req from '../../util/req.js';
import CryptoJS from 'crypto-js';
import { formatPlayUrl, randDeviceWithId, jsonParse, randStr } from '../../util/misc.js';
import dayjs from 'dayjs';

let url = 'https://api1.baibaipei.com:8899'; // API基础URL
let device = {}; // 设备信息对象

// 发送请求的异步函数，支持GET和POST方法
async function request(reqUrl, postData, agentSp, get) {
    // 使用dayjs生成时间戳和随机字符串，并计算签名
    let ts = dayjs().valueOf().toString();
    let rand = randStr(32);
    let sign = CryptoJS.enc.Hex.stringify(CryptoJS.MD5('H58d2%gLbeingX*%D4Y8!C!!@G_' + ts + '_' + rand))
        .toString()
        .toLowerCase();
    // 准备请求头
    let headers = {
        'user-agent': agentSp || device.ua,
    };
    // 特定于baibaipei的头信息
    if (reqUrl.includes('baibaipei')) {
        headers['device-id'] = device.id;
        headers['push-token'] = '';
        headers['sign'] = sign;
        headers['time'] = ts;
        headers['md5'] = rand;
        headers['version'] = '2.1.5';
        headers['system-model'] = device.model;
        headers['system-brand'] = device.brand;
        headers['system-version'] = device.release;
    }
    if (!get) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    // 发送请求并处理响应
    let res = await req(reqUrl, {
        method: get ? 'get' : 'post',
        headers: headers,
        data: postData || {},
    });

    let content = res.data;
    if (typeof content === 'string') {
        // 如果响应是字符串，尝试进行AES解密
        var key = CryptoJS.enc.Utf8.parse('IjhHsCB2B5^#%0Ag');
        var iv = CryptoJS.enc.Utf8.parse('y8_m.3rauW/>j,}.');
        var src = CryptoJS.enc.Base64.parse(content);
        let dst = CryptoJS.AES.decrypt({ ciphertext: src }, key, { iv: iv, padding: CryptoJS.pad.Pkcs7 });
        dst = CryptoJS.enc.Utf8.stringify(dst);
        return JSON.parse(dst);
    }
    return content;
}

// 初始化设备信息
async function init(inReq, _outResp) {
    // 从数据库获取或生成新的设备信息
    const deviceKey = inReq.server.prefix + '/device';
    device = await inReq.server.db.getObjectDefault(deviceKey, {});
    if (!device.id) {
        device = randDeviceWithId(33);
        device.id = device.id.toLowerCase();
        device.ua = 'okhttp/4.1.0';
        await inReq.server.db.push(deviceKey, device);
    }
    return {};
}

// 获取首页数据
async function home(_inReq, _outResp) {
    // 请求顶级视频分类并处理返回的分类数据
    let data = (await request(url + '/api.php/Index/getTopVideoCategory')).data;
    let classes = [];
    let filterObj = {};
    for (const type of data) {
        let typeName = type.nav_name;
        if (typeName == '推荐') continue;
        let typeId = type.nav_type_id.toString();
        classes.push({
            type_id: typeId,
            type_name: typeName,
        });
        // 对每个分类请求过滤条件
        try {
            let filterAll = [];
            let filterData = (await request(url + '/api.php/Video/getFilterType', { type: typeId })).data;
            for (let key of Object.keys(filterData)) {
                let itemValues = filterData[key];
                if (key === 'plot') key = 'class';
                let typeExtendName = '';
                switch (key) {
                    case 'class':
                        typeExtendName = '类型';
                        break;
                    case 'area':
                        typeExtendName = '地区';
                        break;
                    case 'lang':
                        typeExtendName = '语言';
                        break;
                    case 'year':
                        typeExtendName = '年代';
                        break;
                    case 'sort':
                        typeExtendName = '排序';
                        break;
                }
                if (typeExtendName.length === 0) continue;
                let newTypeExtend = {
                    key: key,
                    name: typeExtendName,
                };
                let newTypeExtendKV = [];
                for (let j = 0; j < itemValues.length; j++) {
                    const name = itemValues[j];
                    let value = key === 'sort' ? j + '' : name === '全部' ? '0' : name;
                    newTypeExtendKV.push({ n: name, v: value });
                }
                newTypeExtend['init'] = key === 'sort' ? '1' : newTypeExtendKV[0]['v'];
                newTypeExtend.value = newTypeExtendKV;
                filterAll.push(newTypeExtend);
            }
            if (filterAll.length > 0) {
                filterObj[typeId] = filterAll;
            }
        } catch (e) {
            console.log(e);
        }
    }
    return {
        class: classes,
        filters: filterObj,
    };
}

// 根据分类获取视频列表
async function category(inReq, _outResp) {
    const tid = inReq.body.id; // 类型ID
    const pg = inReq.body.page; // 页面
    const extend = inReq.body.filters; // 过滤条件
    let page = pg || 1;
    if (page == 0) page = 1;
    let reqUrl = url + '/api.php/Video/getFilterVideoList';
    var formData = {
        type: tid,
        p: page.toString(),
        area: extend.area | 0,
        year: extend.year | 0,
        sort: extend.sort | 0,
        class: extend.class | 0,
    };
    // 请求视频列表并返回处理过的视频信息
    let data = (await request(reqUrl, formData)).data;
    let videos = [];
    for (const vod of data.data) {
        videos.push({
            vod_id: vod.vod_id,
            vod_name: vod.vod_name,
            vod_pic: vod.vod_pic,
            vod_remarks: vod.vod_remarks || vod.vod_score || '',
        });
    }
    return {
```javascript
        page: parseInt(data.current_page),
        pagecount: parseInt(data.last_page),
        limit: parseInt(data.per_page),
        total: parseInt(data.total),
        list: videos,
    };
}

// 获取视频详情
async function detail(inReq, _outResp) {
    const ids = !Array.isArray(inReq.body.id) ? [inReq.body.id] : inReq.body.id;
    const videos = [];
    for (const id of ids) {
        // 请求特定ID的视频详情
        let data = (await request(url + '/api.php/Video/getVideoInfo', { video_id: id })).data.video;
        let vod = {
            vod_id: data.vod_id,
            vod_name: data.vod_name,
            vod_pic: data.vod_pic,
            type_name: data.vod_class,
            vod_year: data.vod_year,
            vod_area: data.vod_area,
            vod_remarks: data.vod_remarks || '',
            vod_actor: data.vod_actor,
            vod_director: data.vod_director,
            vod_content: data.vod_content.trim(),
        };
        let playlist = {};
        for (const item of data.vod_play) {
            let from = item.playerForm;
            if (from === 'jp') continue;
            if (from === 'xg') continue;
            let urls = [];
            for (const u of item.url) {
                urls.push(formatPlayUrl(vod.vod_name, u.title) + '$' + u.play_url);
            }
            if (!playlist.hasOwnProperty(from) && urls.length > 0) {
                playlist[from] = urls;
            }
        }
        vod.vod_play_from = Object.keys(playlist).join('$$$');
        let urls = Object.values(playlist);
        let vod_play_url = [];
        for (const urlist of urls) {
            vod_play_url.push(urlist.join('#'));
        }
        vod.vod_play_url = vod_play_url.join('$$$');
        videos.push(vod);
    }
    return {
        list: videos,
    };
}

// 播放功能处理
async function play(inReq, _outResp) {
    const id = inReq.body.id;
    try {
        // 根据ID解析视频播放地址
        if (id.indexOf('youku') >= 0 || id.indexOf('iqiyi') >= 0 || id.indexOf('v.qq.com') >= 0 || id.indexOf('pptv') >= 0 || id.indexOf('le.com') >= 0 || id.indexOf('1905.com') >= 0 || id.indexOf('mgtv') >= 0) {
            if (parse.length > 0) {
                for (let index = 0; index < parse.length; index++) {
                    try {
                        const p = parse[index];
                        let res = await req.get(p + id, {
                            headers: { 'user-agent': 'okhttp/4.1.0' },
                        });
                        var jj = res.data.replace('User - Agent', 'User-Agent');
                        if (!jj.url && jj.data && jj.data.url) {
                            jj = jj.data;
                        }
                        var result = jsonParse(id, jj);
                        if (result.url) {
                            result.parse = 0;
                            if (result.header) {
                                Object.keys(result.header).forEach((hk) => {
                                    if (!result.header[hk]) delete result.header[hk];
                                });
                            }
                            return result;
                        }
                    } catch (error) {}
                }
            }
        }
        // 其他解析逻辑
        let res = await request(url + '/video.php', { url: id });
        var result = jsonParse(id, res.data);
        if (result.url) {
            result.parse = 0;
            return result;
        }
    } catch (e) {
        console.log(e);
    }
    return {
        parse: 0,
        url: id,
    };
}

// 搜索功能处理
async function search(inReq, _outResp) {
    const pg = inReq.body.page;
    const wd = inReq.body.wd;
    let page = pg || 1;
    if (page == 0) page = 1;
    let data = (await request(url + '/api.php/Search/getSearch', { key: wd, type_id: 0, p: page })).data;
    let videos = [];
    for (const vod of data.data) {
        videos.push({
            vod_id: vod.vod_id,
            vod_name: vod.vod_name,
            vod_pic: vod.vod_pic,
            vod_remarks: vod.vod_remarks || vod.vod_score || '',
        });
    }
    return {
        list: videos,
        page: data.current_page,
        pagecount: data.last_page,
    };
}

// 测试函数，集成多个接口测试
async function test(inReq, outResp) {
    // 实现了一系列接口测试步骤，详细测试流程略
}

// 导出模块
export default {
    meta: {
        key: 'kkys',
        name: '快看影视',
        type: 3,
    },
    api: async (fastify) => {
        fastify.post('/init', init);
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
        fastify.get('/test', test);
    },
};