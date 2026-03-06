/*
📝 | LOYALTY MD Bot v4.0
🖥️ | Powered by gifted-baileys + gifted-btns
*/

const fs = require('fs');
const fg = require('api-dylux');
const axios = require('axios');
const yts = require("yt-search");
const { igdl } = require("btch-downloader");
const util = require('util');
const fetch = require('node-fetch');
const { exec } = require('child_process');
const path = require('path');
const chalk = require('chalk');
const { writeFile } = require('./library/utils');
const config = require('./config');
const { getOwners, addOwner, removeOwner, getSudo, addSudo, removeSudo } = require('./database/store');
const { sendButtons } = require('gifted-btns');

// =============== COLORS ===============
const colors = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    white: "\x1b[37m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    magenta: "\x1b[35m",
    bgGreen: "\x1b[42m",
};

// =============== HELPERS ===============
function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
}

function stylishReply(text) {
    return `\`\`\`\n${text}\n\`\`\``;
}

function checkFFmpeg() {
    return new Promise((resolve) => {
        exec("ffmpeg -version", (err) => resolve(!err));
    });
}

// ======= Safe JID decode helper =======
function jidDecode(jid) {
    if (!jid) return null;
    // Handle format like "1234:56@s.whatsapp.net"
    const atIndex = jid.indexOf('@');
    if (atIndex < 0) return null;
    const userPart = jid.substring(0, atIndex);
    const server = jid.substring(atIndex + 1);
    // Strip the device suffix (e.g., "1234:56" -> "1234")
    const user = userPart.split(':')[0];
    return { user, server };
}

// =============== MAIN FUNCTION ===============
module.exports = async function handleCommand(trashcore, m, command, isGroup, isAdmin, groupAdmins,isBotAdmins,groupMeta,config) {

    // ======= Safe JID decoding (set once) =======
    if (!trashcore.decodeJid) {
        trashcore.decodeJid = (jid) => {
            if (!jid) return jid;
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {};
                return decode.user && decode.server ? `${decode.user}@${decode.server}` : jid;
            } else return jid;
        };
    }
    const from = trashcore.decodeJid(m.key.remoteJid);
    // baileys v7 uses LID addressing; participantAlt has the real phone JID
    const sender = m.key.participantAlt || m.key.participant || m.key.remoteJid;
    const participant = trashcore.decodeJid(m.key.participantAlt || m.key.participant || from);
    const pushname = m.pushName || "Unknown User";
    const chatType = from.endsWith('@g.us') ? 'Group' : 'Private';
    const chatName = chatType === 'Group' ? (groupMeta?.subject || 'Unknown Group') : pushname;
// Safe owner check — supports multiple owners + sudo users
const botNumber = (trashcore.user?.id?.split(":")[0] || '') + "@s.whatsapp.net";
const senderJid = m.key.participantAlt || m.key.participant || m.key.remoteJid;
const senderNumber = senderJid.split('@')[0].split(':')[0];
const ownersList = [config.OWNER_NUMBER, ...getOwners()].filter(Boolean);
const isOwner = senderJid === botNumber || ownersList.includes(senderNumber);
const isSudo = isOwner || getSudo().includes(senderNumber);
    const reply = (text) => trashcore.sendMessage(from, { text: stylishReply(text) }, { quoted: m });

    const ctx = m.message.extendedTextMessage?.contextInfo || {};
    const quoted = ctx.quotedMessage;
    const quotedSender = trashcore.decodeJid(ctx.participant || from);
    const mentioned = ctx.mentionedJid?.map(trashcore.decodeJid) || [];

    const body = m.body || m.message.conversation || m.message.extendedTextMessage?.text || '';
    const args = body.trim().split(/ +/).slice(1);
    const text = args.join(" ");

    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${pushname} | ${chatName} | cmd:${command || '-'} | ${body.substring(0, 40)}`);
// --- 🚨 ANTILINK 2.0 AUTO CHECK ---
if (isGroup && global.antilink && global.antilink[from]?.enabled) {
    const linkPattern = /(https?:\/\/[^\s]+)/gi;
    const bodyText = body || '';

    if (linkPattern.test(bodyText)) {
        const settings = global.antilink[from];
        const _gAdmins = groupMeta ? groupMeta.participants.filter(p => p.admin).map(p => p.id) : [];
        const _bNum = (trashcore.user?.id?.split(":")[0] || '') + "@s.whatsapp.net";
        const _isBotAdmin = _gAdmins.includes(_bNum);
        const _isSenderAdmin = _gAdmins.includes(sender);

        if (!_isSenderAdmin && _isBotAdmin) {
            try {
                await trashcore.sendMessage(from, { delete: m.key });
                await trashcore.sendMessage(from, {
                    text: `🚫 *Link detected and removed!*\nUser: @${sender.split('@')[0]}\nAction: ${settings.mode.toUpperCase()}`,
                    mentions: [sender],
                });

                if (settings.mode === "kick") {
                    await trashcore.groupParticipantsUpdate(from, [sender], "remove");
                }
            } catch (err) {
                console.error("Antilink Enforcement Error:", err);
            }
        }
    }
}

// --- 🚫 ANTI-TAG AUTO CHECK ---
if (isGroup && global.antitag && global.antitag[from]?.enabled) {
    const settings = global.antitag[from];
    const _tgAdmins = groupMeta ? groupMeta.participants.filter(p => p.admin).map(p => p.id) : [];
    const _tBNum = (trashcore.user?.id?.split(":")[0] || '') + "@s.whatsapp.net";
    const _tIsBotAdmin = _tgAdmins.includes(_tBNum);
    const _tIsSenderAdmin = _tgAdmins.includes(sender);

    // Detect if message contains a mention
    const mentionedUsers = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    if (mentionedUsers.length > 0) {
        if (!_tIsSenderAdmin && _tIsBotAdmin) {
            try {
                await trashcore.sendMessage(from, { delete: m.key });
                await trashcore.sendMessage(from, {
                    text: `🚫 *Tagging others is not allowed!*\nUser: @${sender.split('@')[0]}\nAction: ${settings.mode.toUpperCase()}`,
                    mentions: [sender],
                });
                if (settings.mode === "kick") {
                    await trashcore.groupParticipantsUpdate(from, [sender], "remove");
                }
            } catch (err) {
                console.error("Anti-Tag Enforcement Error:", err);
            }
        }
    }
}

// 🚫 AntiBadWord with Strike System
if (isGroup && global.antibadword?.[from]?.enabled) {
  const badwords = global.antibadword[from].words || [];
  const textMsg = (body || "").toLowerCase();
  const found = badwords.find(w => textMsg.includes(w));

  if (found) {
    const bNum = (trashcore.user?.id?.split(":")[0] || '') + "@s.whatsapp.net";
    const _bwAdmins = groupMeta ? groupMeta.participants.filter(p => p.admin).map(p => p.id) : [];
    const isBotAdmin = _bwAdmins.includes(bNum);
    const isSenderAdmin = _bwAdmins.includes(sender);

    if (!isSenderAdmin) {
      if (isBotAdmin) {
        await trashcore.sendMessage(from, { delete: m.key });
      }

      global.antibadword[from].warnings[sender] =
        (global.antibadword[from].warnings[sender] || 0) + 1;

      const warns = global.antibadword[from].warnings[sender];
      const remaining = 3 - warns;

      if (warns < 3) {
        await trashcore.sendMessage(from, {
          text: `⚠️ @${sender.split('@')[0]}, bad word detected!\nWord: *${found}*\nWarning: *${warns}/3*\n${remaining} more and you'll be kicked!`,
          mentions: [sender],
        });
      } else {
        if (isBotAdmin) {
          await trashcore.sendMessage(from, {
            text: `🚫 @${sender.split('@')[0]} has been kicked for repeated bad words.`,
            mentions: [sender],
          });
          await trashcore.groupParticipantsUpdate(from, [sender], "remove");
          delete global.antibadword[from].warnings[sender];
        } else {
          await trashcore.sendMessage(from, {
            text: `🚨 @${sender.split('@')[0]} reached 3 warnings, but I need admin rights to kick!`,
            mentions: [sender],
          });
        }
      }
    }
  }
}

if (!trashcore.isPublic && !isOwner && !isSudo) {
    return; // ignore all messages from non-owner/non-sudo when in private mode
}
    try {
        switch (command) {
            // ================= PING =================
            case 'ping':
            case 'alive': {
                const start = Date.now();
                await reply(`🏓 Pong!\nSpeed: ${Date.now() - start}ms\nUptime: ${formatUptime(process.uptime())}\nOwner: LOYALTY MD`);
                break;
            }

            // ================= MENU =================
            case 'menu':
            case 'help': {
                const menuText = `👑 Creator: LOYALTY MD
📝 Type: Base Script
⚡ Version: 4.0.0
📦 Engine: gifted-baileys

|COMMANDS|

📊 SYSTEM
• ping 
• public 
• private 

🤖 BOT MANAGEMENT
• addbot
• delbot
• addsession
• delsession
• sessions

👑 OWNER / SUDO
• addowner
• delowner
• addsudo
• delsudo
• listowners
• listsudo

🥁 ANALYSIS 
• weather 
• checktime 
• gitclone 
• save 

🛟 MEDIA
• tiktok
• play
• igdl
• fb
• video 
• playdoc

👥 GROUP
• add
• kick
• promote 
• demote
• antilink
• antitag
• antipromote 
• antidemote 
• antibadword 
• tagall
• hidetag

📍 CONVERSION
• toaudio 
• tovoicenote 
• toimage

👤 BASIC
• copilot
• >
• <
• =>`;
                try {
                    await sendButtons(trashcore, from, {
                        text: stylishReply(menuText),
                        footer: '🖥️ Powered by gifted-baileys',
                        buttons: [
                            { id: 'ping', text: '🏓 Ping' },
                            { id: 'weather', text: '🌤️ Weather' },
                            { id: 'play', text: '🎵 Play Music' }
                        ]
                    });
                } catch (btnErr) {
                    await reply(menuText);
                }
                break;
            }

            // ================= WEATHER =================
            case 'weather': {
                try {
                    if (!text) return reply("🌍 Please provide a city or town name!");
                    const response = await fetch(`http://api.openweathermap.org/data/2.5/weather?q=${text}&units=metric&appid=1ad47ec6172f19dfaf89eb3307f74785`);
                    const data = await response.json();
                    if (data.cod !== 200) return reply("❌ Unable to find that location. Please check the spelling.");

                    const weatherText = `
🌤️ *Weather Report for ${data.name}*
🌡️ Temperature: ${data.main.temp}°C
🌬️ Feels Like: ${data.main.feels_like}°C
🌧️ Rain Volume: ${data.rain?.['1h'] || 0} mm
☁️ Cloudiness: ${data.clouds.all}%
💧 Humidity: ${data.main.humidity}%
🌪️ Wind Speed: ${data.wind.speed} m/s
📝 Condition: ${data.weather[0].description}
🌄 Sunrise: ${new Date(data.sys.sunrise*1000).toLocaleTimeString()}
🌅 Sunset: ${new Date(data.sys.sunset*1000).toLocaleTimeString()}
`;
                    await reply(weatherText);
                } catch (e) {
                    console.error("Weather command error:", e);
                    reply("❌ Unable to retrieve weather information.");
                }
                break;
            }

            // ================= CHECKTIME =================
            case 'checktime':
            case 'time': {
                try {
                    if (!text) return reply("🌍 Please provide a city or country name to check the local time.");
                    await reply(`⏳ Checking local time for *${text}*...`);
                    const tzRes = await fetch(`https://worldtimeapi.org/api/timezone`);
                    const timezones = await tzRes.json();
                    const match = timezones.find(tz => tz.toLowerCase().includes(text.toLowerCase()));
                    if (!match) return reply(`❌ Could not find timezone for *${text}*.`);
                    const res = await fetch(`https://worldtimeapi.org/api/timezone/${match}`);
                    const data = await res.json();
                    const datetime = new Date(data.datetime);
                    const hours = datetime.getHours();
                    const greeting = hours < 12 ? "🌅 Good Morning" : hours < 18 ? "🌞 Good Afternoon" : "🌙 Good Evening";
                    const timeText = `
🕒 Local Time in ${text}
${greeting} 👋
📍 Timezone: ${data.timezone}
⏰ Time: ${datetime.toLocaleTimeString()}
📆 Date: ${datetime.toDateString()}
⏱️ Uptime: ${formatUptime(process.uptime())}`;
                    await reply(timeText);
                } catch (e) {
                    console.error("checktime error:", e);
                    reply("❌ Unable to fetch time for that city.");
                }
                break;
            }

            // ================= GITCLONE =================
            case 'gitclone': {
                try {
                    if (!args[0]) return reply("❌ Provide a GitHub repo link.");
                    if (!args[0].includes('github.com')) return reply("❌ Not a valid GitHub link!");
                    const regex = /(?:https|git)(?::\/\/|@)github\.com[\/:]([^\/:]+)\/(.+)/i;
                    let [, user, repo] = args[0].match(regex) || [];
                    repo = repo.replace(/.git$/, '');
                    const zipUrl = `https://api.github.com/repos/${user}/${repo}/zipball`;
                    const head = await fetch(zipUrl, { method: 'HEAD' });
                    const contentDisp = head.headers.get('content-disposition');
                    const filenameMatch = contentDisp?.match(/attachment; filename=(.*)/);
                    const filename = filenameMatch ? filenameMatch[1] : `${repo}.zip`;
                    await trashcore.sendMessage(from, { document: { url: zipUrl }, fileName: filename, mimetype: 'application/zip' }, { quoted: m });
                    await reply(`✅ Successfully fetched repository: *${user}/${repo}*`);
                } catch (err) {
                    console.error("gitclone error:", err);
                    await reply("❌ Failed to clone repository.");
                }
                break;
            }


            // ================= SAVE STATUS =================
            case 'save': {
                try {
                    if (!quoted) return reply("❌ Reply to a status message!");
                    const mediaBuffer = await trashcore.downloadMediaMessage(quoted);
                    if (!mediaBuffer) return reply("🚫 Could not download media. It may have expired.");
                    let payload;
                    if (quoted.imageMessage) payload = { image: mediaBuffer, caption: quoted.imageMessage.caption || "📸 Saved status image", mimetype: "image/jpeg" };
                    else if (quoted.videoMessage) payload = { video: mediaBuffer, caption: quoted.videoMessage.caption || "🎥 Saved status video", mimetype: "video/mp4" };
                    else return reply("❌ Only image/video statuses are supported!");
                    await trashcore.sendMessage(m.sender, payload, { quoted: m });
                    await reply("✅ Status saved!");
                } catch (err) {
                    console.error("Save error:", err);
                    reply("❌ Failed to save status.");
                }
                break;
            }

            // ================= IG/FB DL =================
            case 'fb':
            case 'facebook':
            case 'fbdl':
            case 'ig':
            case 'instagram':
            case 'igdl': {
                if (!args[0]) return reply(`🔗 Provide a Facebook or Instagram link!\n\nExample: ${command} <link>`);
                try {
                    const axios = require('axios');
                    const cheerio = require('cheerio');

                    const progressMsg = await trashcore.sendMessage(from, { text: stylishReply("⏳ Fetching media... Please wait!") }, { quoted: m });

                    async function fetchMedia(url) {
                        try {
                            const form = new URLSearchParams();
                            form.append("q", url);
                            form.append("vt", "home");

                            const { data } = await axios.post('https://yt5s.io/api/ajaxSearch', form, {
                                headers: {
                                    "Accept": "application/json",
                                    "X-Requested-With": "XMLHttpRequest",
                                    "Content-Type": "application/x-www-form-urlencoded",
                                },
                            });

                            if (data.status !== "ok") throw new Error("Provide a valid link.");
                            const $ = cheerio.load(data.data);

                            if (/^(https?:\/\/)?(www\.)?(facebook\.com|fb\.watch)\/.+/i.test(url)) {
                                const thumb = $('img').attr("src");
                                let links = [];
                                $('table tbody tr').each((_, el) => {
                                    const quality = $(el).find('.video-quality').text().trim();
                                    const link = $(el).find('a.download-link-fb').attr("href");
                                    if (quality && link) links.push({ quality, link });
                                });
                                if (links.length > 0) return { platform: "facebook", type: "video", thumb, media: links[0].link };
                                if (thumb) return { platform: "facebook", type: "image", media: thumb };
                                throw new Error("Media is invalid.");
                            } else if (/^(https?:\/\/)?(www\.)?(instagram\.com\/(p|reel)\/).+/i.test(url)) {
                                const video = $('a[title="Download Video"]').attr("href");
                                const image = $('img').attr("src");
                                if (video) return { platform: "instagram", type: "video", media: video };
                                if (image) return { platform: "instagram", type: "image", media: image };
                                throw new Error("Media invalid.");
                            } else {
                                throw new Error("Provide a valid URL or link.");
                            }
                        } catch (err) {
                            return { error: err.message };
                        }
                    }

                    const res = await fetchMedia(args[0]);
                    if (res.error) {
                        await trashcore.sendMessage(from, { react: { text: "❌", key: m.key } });
                        return reply(`⚠️ Error: ${res.error}`);
                    }

                    await trashcore.sendMessage(from, { text: stylishReply("⏳ Media found! Downloading now...") }, { quoted: m });

                    if (res.type === "video") {
                        await trashcore.sendMessage(from, { video: { url: res.media }, caption: stylishReply(`✅ Downloaded video from ${res.platform}!`) }, { quoted: m });
                    } else if (res.type === "image") {
                        await trashcore.sendMessage(from, { image: { url: res.media }, caption: stylishReply(`✅ Downloaded photo from ${res.platform}!`) }, { quoted: m });
                    }

                    await trashcore.sendMessage(from, { text: stylishReply("✅ Done!") }, { quoted: m });

                } catch (error) {
                    console.error(error);
                    await trashcore.sendMessage(from, { react: { text: "❌", key: m.key } });
                    return reply("❌ Failed to get media.");
                }
                break;
            }

            // ================= TIKTOK =================
            case 'tiktok':
            case 'tt': {
                try {
                    if (!args[0]) return reply(`⚠️ Provide a TikTok link.\nExample: ${command} https://vm.tiktok.com/...`);
                    await reply("⏳ Fetching TikTok video...");

                    const ttApi = `https://apis.davidcyril.name.ng/download/tiktok?url=${encodeURIComponent(args[0])}&apikey=`;
                    const ttRes = await fetch(ttApi);
                    const ttData = await ttRes.json();

                    if (!ttData.success || !ttData.result) {
                        return reply("❌ Failed to fetch TikTok data. Make sure the link is valid.");
                    }

                    const tt = ttData.result;
                    let caption = `🎵 *TIKTOK DOWNLOAD*\n\n`;
                    caption += `◦ Author: ${tt.author || 'Unknown'}\n`;
                    caption += `◦ Title: ${tt.title || 'No title'}\n`;
                    caption += `> *Powered by LOYALTY MD*`;

                    if (tt.video) {
                        await trashcore.sendMessage(from, {
                            video: { url: tt.video },
                            mimetype: 'video/mp4',
                            caption: stylishReply(caption)
                        }, { quoted: m });
                    } else if (tt.images && tt.images.length > 0) {
                        for (const imgUrl of tt.images) {
                            await trashcore.sendMessage(from, { image: { url: imgUrl } }, { quoted: m });
                        }
                    } else {
                        return reply("❌ No downloadable media found.");
                    }

                } catch (err) {
                    console.error("TikTok command error:", err);
                    return reply("❌ Failed to fetch TikTok data. Make sure the link is valid.");
                }
                break;
            }
case 'video': {
    try {
        if (!text) return reply('❌ What video do you want to download?');

        let videoUrl = '';
        let videoTitle = '';
        let videoThumbnail = '';

        if (text.startsWith('http://') || text.startsWith('https://')) {
            videoUrl = text;
        } else {
            const { videos } = await yts(text);
            if (!videos || videos.length === 0) return reply('❌ No videos found!');
            videoUrl = videos[0].url;
            videoTitle = videos[0].title;
            videoThumbnail = videos[0].thumbnail;
        }

        const izumi = { baseURL: "https://izumiiiiiiii.dpdns.org" };
        const AXIOS_DEFAULTS = {
            timeout: 60000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*'
            }
        };

        const tryRequest = async (getter, attempts = 3) => {
            let lastError;
            for (let attempt = 1; attempt <= attempts; attempt++) {
                try { return await getter(); } 
                catch (err) { 
                    lastError = err; 
                    if (attempt < attempts) await new Promise(r => setTimeout(r, 1000 * attempt));
                }
            }
            throw lastError;
        };

        const getIzumiVideoByUrl = async (youtubeUrl) => {
            const apiUrl = `${izumi.baseURL}/downloader/youtube?url=${encodeURIComponent(youtubeUrl)}&format=720`;
            const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
            if (res?.data?.result?.download) return res.data.result;
            throw new Error('Izumi API returned no download');
        };

        const getOkatsuVideoByUrl = async (youtubeUrl) => {
            const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
            const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
            if (res?.data?.result?.mp4) {
                return { download: res.data.result.mp4, title: res.data.result.title };
            }
            throw new Error('Okatsu API returned no mp4');
        };

        // Send thumbnail
        try {
            const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
            const thumb = videoThumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : undefined);
            const captionTitle = videoTitle || text;
            if (thumb) {
                await trashcore.sendMessage(from, {
                    image: { url: thumb },
                    caption: `🎬 *Title:* ${captionTitle}\n📥 Download your video below!`,
                }, { quoted: m });
            }
        } catch (e) {
            console.error('[VIDEO] Thumbnail Error:', e?.message || e);
        }

        // Validate YouTube URL
        const urls = videoUrl.match(/(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/|playlist\?list=)?)([a-zA-Z0-9_-]{11})/gi);
        if (!urls) return reply('❌ This is not a valid YouTube link!');

        // Try downloading video
        let videoData;
        try { videoData = await getIzumiVideoByUrl(videoUrl); } 
        catch (e1) {
            console.warn('[VIDEO] Izumi failed, trying Okatsu:', e1?.message || e1);
            videoData = await getOkatsuVideoByUrl(videoUrl);
        }

        await trashcore.sendMessage(from, {
            video: { url: videoData.download },
            mimetype: 'video/mp4',
            fileName: `${videoData.title || videoTitle || 'video'}.mp4`,
            caption: `🎥 *Video:* ${videoData.title || videoTitle || 'Unknown'}\n`,
        }, { quoted: m });

    } catch (error) {
        console.error('[VIDEO] Command Error:', error?.message || error);
        reply('❌ Download failed: ' + (error?.message || 'Unknown error'));
    }
    break;
}
            // ================= PLAY (MUSIC) =================
            case 'play':
            case 'music': {
                try {
                    if (!args.length) return reply(`🎵 Please enter a music name.\nExample: ${command} Sanam Teri Kasam`);

                    const query = args.join(" ");
                    if (query.length > 100) return reply(`📝 Song name too long! Max 100 chars.`);

                    await reply("🎧 Searching for the track... ⏳");

                    const api = `https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(query)}`;
                    const res = await fetch(api);
                    const data = await res.json();

                    if (!data.status || !data.result || !data.result.download_url) {
                        return reply("❌ No song found, try again.");
                    }

                    const caption = `☘️ Tɪᴛʟᴇ : ${data.result.title || 'Unknown'}\n❒ ⏱️ Dᴜʀᴀᴛɪᴏɴ : ${data.result.duration || '-'}\n❒ 🎭 Vɪᴇᴡs : ${data.result.views || '-'}\n*ᴜsᴇ ʜᴇᴀᴅᴘʜᴏɴᴇs ꜰᴏʀ ʙᴇsᴛ ᴇxᴘᴇʀɪᴇɴᴄᴇ...☊*\n> *Pᴏᴡᴇʀᴇᴅ Bʏ LOYALTY MD 🫟*`;

                    // Send thumbnail if available
                    if (data.result.thumbnail) {
                        await trashcore.sendMessage(from, {
                            image: { url: data.result.thumbnail },
                            caption: stylishReply(caption)
                        }, { quoted: m });
                    }

                    // Send audio
                    await trashcore.sendMessage(from, {
                        audio: { url: data.result.download_url },
                        mimetype: 'audio/mp4',
                        ptt: false
                    }, { quoted: m });

                } catch (error) {
                    console.error("Play command error:", error);
                    return reply(`❌ An error occurred while processing your request.`);
                }
                break;
            }
// ================= TO AUDIO  =================
case 'toaudio': {
    try {
        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
        const ffmpeg = require('fluent-ffmpeg');
        const { writeFileSync, unlinkSync } = require('fs');
        const { tmpdir } = require('os');
        const path = require('path');

        // ✅ Pick source message
        const quoted = m.quoted ? m.quoted : m;
        const msg = quoted.msg || quoted.message?.videoMessage || quoted.message?.audioMessage;

        if (!msg) return reply("🎧 Reply to a *video* or *audio* to convert it to audio!");

        // ✅ Get MIME type
        const mime = msg.mimetype || quoted.mimetype || '';
        if (!/video|audio/.test(mime)) return reply("⚠️ Only works on *video* or *audio* messages!");

        reply("🎶 Converting to audio...");

        // ✅ Download media
        const messageType = mime.split("/")[0];
        const stream = await downloadContentFromMessage(msg, messageType);

        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // ✅ Temporary paths
        const inputPath = path.join(tmpdir(), `input_${Date.now()}.mp4`);
        const outputPath = path.join(tmpdir(), `output_${Date.now()}.mp3`);
        writeFileSync(inputPath, buffer);

        // ✅ Convert using ffmpeg
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .toFormat('mp3')
                .on('end', resolve)
                .on('error', reject)
                .save(outputPath);
        });

        // ✅ Send converted audio
        const audioBuffer = fs.readFileSync(outputPath);
        await trashcore.sendMessage(from, { audio: audioBuffer, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });

        // ✅ Cleanup
        unlinkSync(inputPath);
        unlinkSync(outputPath);

        reply("✅ Conversion complete!");
    } catch (err) {
        console.error("❌ toaudio error:", err);
        reply("💥 Failed to convert media to audio. Ensure it's a valid video/audio file.");
    }
    break;
}

// ================= TO VOICE NOTE  =================
case 'tovoicenote': {
    try {
        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
        const ffmpeg = require('fluent-ffmpeg');
        const fs = require('fs');
        const path = require('path');
        const { tmpdir } = require('os');

        // ✅ Determine source message
        const quoted = m.quoted ? m.quoted : m;
        const msg = quoted.msg || quoted.message?.videoMessage || quoted.message?.audioMessage;

        if (!msg) return reply("🎧 Reply to a *video* or *audio* to convert it to a voice note!");

        const mime = msg.mimetype || quoted.mimetype || '';
        if (!/video|audio/.test(mime)) return m.reply("⚠️ Only works on *video* or *audio* messages!");

        reply("🔊 Converting to voice note...");

        // ✅ Download media
        const messageType = mime.split("/")[0];
        const stream = await downloadContentFromMessage(msg, messageType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // ✅ Temp files
        const inputPath = path.join(tmpdir(), `input_${Date.now()}.mp4`);
        const outputPath = path.join(tmpdir(), `output_${Date.now()}.ogg`);
        fs.writeFileSync(inputPath, buffer);

        // ✅ Convert to PTT using ffmpeg (Opus in OGG)
        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .inputOptions('-t 59') // optional: limit duration to 59s
                .toFormat('opus')
                .outputOptions(['-c:a libopus', '-b:a 64k'])
                .on('end', resolve)
                .on('error', reject)
                .save(outputPath);
        });

        // ✅ Send voice note
        const audioBuffer = fs.readFileSync(outputPath);
        await trashcore.sendMessage(from, { audio: audioBuffer, mimetype: 'audio/ogg', ptt: true }, { quoted: m });

        // ✅ Cleanup
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);

        reply("✅ Voice note sent!");
    } catch (err) {
        console.error("❌ tovoicenote error:", err);
        m.reply("💥 Failed to convert media to voice note. Make sure it is a valid video/audio file.");
    }
    break;
}
// ================= TO IMAGE =================
case 'toimage': {
    try {
        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
        const fs = require('fs');
        const path = require('path');
        const { tmpdir } = require('os');
        const sharp = require('sharp');

        // ✅ Determine source message
        const quoted = m.quoted ? m.quoted : m;
        const msg = quoted.msg || quoted.message?.stickerMessage;
        if (!msg || !msg.mimetype?.includes('webp')) {
            return reply("⚠️ Reply to a *sticker* to convert it to an image!");
        }

        m.reply("🖼️ Converting sticker to image...");

        // ✅ Download sticker
        const stream = await downloadContentFromMessage(msg, 'sticker');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // ✅ Convert WebP to PNG using sharp
        const outputPath = path.join(tmpdir(), `sticker_${Date.now()}.png`);
        await sharp(buffer).png().toFile(outputPath);

        // ✅ Send converted image
        const imageBuffer = fs.readFileSync(outputPath);
        await trashcore.sendMessage(from, { image: imageBuffer }, { quoted: m });

        // ✅ Cleanup
        fs.unlinkSync(outputPath);
        reply("✅ Sticker converted to image!");
    } catch (err) {
        console.error("❌ toimage error:", err);
        reply("💥 Failed to convert sticker to image.");
    }
    break;
}

// ================= PRIVATE / SELF COMMAND =================
case 'private':
case 'self': {
    if (!isOwner) return reply("❌ This command is for owner-only.");
    trashcore.isPublic = false;
    await reply("✅ Bot switched to *private mode*. Only the owner can use commands now.");
    break;
}
// ================= PUBLIC COMMAND =================
case 'public': {
    if (!isOwner) return reply("❌ This command is for owner-only.");
    trashcore.isPublic = true;
    await reply("🌍 Bot switched to *public mode*. Everyone can use commands now.");
    break;
}

// ================= SESSION MANAGEMENT =================
case 'addsession': {
    if (!isOwner) return reply("❌ Owner only.");
    if (!args[0]) return reply(`📲 Provide a session ID!\nExample: addsession <session_id>\n\nGet one at: https://loyalty-md-session.vercel.app`);
    
    const newSessionId = args[0].trim();
    
    if (global.activeSessions[newSessionId]) {
        return reply(`⚠️ Session "${newSessionId}" is already running!`);
    }
    
    try {
        // Use global startSession to avoid circular require
        if (!global.startSession) return reply('❌ Bot not fully initialized. Try again in a moment.');
        await reply(`⏳ Starting session "${newSessionId}"...`);
        const sock = await global.startSession(newSessionId, false);
        if (sock) {
            await reply(`✅ Session "${newSessionId}" added and connecting!`);
        } else {
            await reply(`❌ Could not start session. Make sure the session ID is valid and has credentials.`);
        }
    } catch (err) {
        console.error('addsession error:', err);
        await reply(`❌ Error: ${err.message}`);
    }
    break;
}

case 'delsession': {
    if (!isOwner) return reply("❌ Owner only.");
    if (!args[0]) return reply(`🗑️ Provide the session name to delete.\nExample: delsession <session_name>`);
    
    const delId = args[0].trim();
    
    if (delId === 'main') return reply(`❌ Cannot delete the main session!`);
    
    try {
        // Disconnect the socket if active
        if (global.activeSessions[delId]) {
            try { global.activeSessions[delId].end(); } catch (_) {}
            delete global.activeSessions[delId];
        }
        
        // Remove local session files
        const sessionPath = require('path').join(__dirname, 'sessions', delId);
        if (require('fs').existsSync(sessionPath)) {
            require('fs').rmSync(sessionPath, { recursive: true, force: true });
        }
        
        // Remove from DB
        const { deleteSession } = require('./database/mongodb');
        await deleteSession(delId);
        
        await reply(`✅ Session "${delId}" has been deleted and disconnected.`);
    } catch (err) {
        console.error('delsession error:', err);
        await reply(`❌ Error: ${err.message}`);
    }
    break;
}

case 'sessions':
case 'listsessions': {
    if (!isOwner) return reply("❌ Owner only.");
    
    const activeIds = Object.keys(global.activeSessions || {});
    if (activeIds.length === 0) {
        return reply('📵 No active sessions.');
    }
    
    let list = `📱 *Active Sessions (${activeIds.length}):*\n\n`;
    for (const sid of activeIds) {
        const sock = global.activeSessions[sid];
        const num = sock?.user?.id?.split(':')[0] || 'connecting...';
        list += `• *${sid}* — ${num}\n`;
    }
    list += `\n🔗 Get session IDs at:\nhttps://loyalty-md-session.vercel.app`;
    await reply(list);
    break;
}

// ================= ADD BOT (alias for addsession) =================
case 'addbot': {
    if (!isOwner) return reply("❌ Owner only.");
    if (!args[0]) return reply(`🤖 Provide a session ID to add a new bot!\nExample: addbot <session_id>\n\nGet one at: https://loyalty-md-session.vercel.app`);
    
    const botSessionId = args[0].trim();
    
    if (global.activeSessions[botSessionId]) {
        return reply(`⚠️ Bot "${botSessionId}" is already running!`);
    }
    
    try {
        if (!global.startSession) return reply('❌ Bot not fully initialized. Try again in a moment.');
        await reply(`⏳ Adding bot "${botSessionId}"...`);
        const newSock = await global.startSession(botSessionId, false);
        if (newSock) {
            await reply(`✅ Bot "${botSessionId}" added and connecting!\n\n📱 Active bots: ${Object.keys(global.activeSessions).length}`);
        } else {
            await reply(`❌ Could not start bot. Make sure the session ID is valid and has credentials.`);
        }
    } catch (err) {
        console.error('addbot error:', err);
        await reply(`❌ Error: ${err.message}`);
    }
    break;
}

// ================= DEL BOT (alias for delsession) =================
case 'delbot': {
    if (!isOwner) return reply("❌ Owner only.");
    if (!args[0]) return reply(`🗑️ Provide the bot session to remove.\nExample: delbot <session_id>`);
    
    const delBotId = args[0].trim();
    
    if (delBotId === 'main') return reply(`❌ Cannot delete the main bot!`);
    
    try {
        if (global.activeSessions[delBotId]) {
            try { global.activeSessions[delBotId].end(); } catch (_) {}
            delete global.activeSessions[delBotId];
        }
        
        const sessionPath = path.join(__dirname, 'sessions', delBotId);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
        
        const { deleteSession } = require('./database/mongodb');
        await deleteSession(delBotId);
        
        await reply(`✅ Bot "${delBotId}" removed and disconnected.\n\n📱 Remaining bots: ${Object.keys(global.activeSessions).length}`);
    } catch (err) {
        console.error('delbot error:', err);
        await reply(`❌ Error: ${err.message}`);
    }
    break;
}

// ================= ADD OWNER =================
case 'addowner': {
    if (!isOwner) return reply("❌ Only existing owners can add new owners.");
    if (!args[0]) return reply(`👑 Provide a phone number to add as owner.\nExample: addowner 2547xxxxxxxx`);
    
    try {
        const num = args[0].replace(/[^0-9]/g, '');
        if (num.length < 7) return reply("❌ Invalid phone number.");
        
        const added = addOwner(num);
        if (added) {
            await reply(`✅ @${num} has been added as an *owner*!\n\nThey can now use all owner commands.`);
        } else {
            await reply(`⚠️ ${num} is already an owner.`);
        }
    } catch (err) {
        console.error('addowner error:', err);
        await reply(`❌ Error: ${err.message}`);
    }
    break;
}

// ================= DEL OWNER =================
case 'delowner':
case 'removeowner': {
    if (!isOwner) return reply("❌ Only owners can remove other owners.");
    if (!args[0]) return reply(`🗑️ Provide the number to remove from owners.\nExample: delowner 2547xxxxxxxx`);
    
    try {
        const num = args[0].replace(/[^0-9]/g, '');
        if (num === config.OWNER_NUMBER) return reply("❌ Cannot remove the primary owner from config!");
        
        const removed = removeOwner(num);
        if (removed) {
            await reply(`✅ ${num} has been removed from owners.`);
        } else {
            await reply(`⚠️ ${num} is not in the owners list.`);
        }
    } catch (err) {
        console.error('delowner error:', err);
        await reply(`❌ Error: ${err.message}`);
    }
    break;
}

// ================= LIST OWNERS =================
case 'listowners':
case 'owners': {
    if (!isOwner) return reply("❌ Owner only.");
    
    try {
        const dynamicOwners = getOwners();
        let ownerText = `👑 *Owner List:*\n\n`;
        ownerText += `• *${config.OWNER_NUMBER}* (primary - config)\n`;
        if (dynamicOwners.length > 0) {
            for (const o of dynamicOwners) {
                ownerText += `• *${o}* (added)\n`;
            }
        }
        ownerText += `\nTotal: ${1 + dynamicOwners.length} owner(s)`;
        await reply(ownerText);
    } catch (err) {
        console.error('listowners error:', err);
        await reply(`❌ Error: ${err.message}`);
    }
    break;
}

// ================= ADD SUDO / SUB-USER =================
case 'sudo':
case 'addsudo': {
    if (!isOwner) return reply("❌ Only owners can add sudo users.");
    if (!args[0]) return reply(`🔑 Provide a phone number to add as sudo.\nExample: sudo 2547xxxxxxxx\n\nSudo users can use the bot in private mode and some elevated commands.`);
    
    try {
        const num = args[0].replace(/[^0-9]/g, '');
        if (num.length < 7) return reply("❌ Invalid phone number.");
        
        const added = addSudo(num);
        if (added) {
            await reply(`✅ @${num} has been added as a *sudo user*!\n\nThey can now use the bot in private mode.`);
        } else {
            await reply(`⚠️ ${num} is already a sudo user.`);
        }
    } catch (err) {
        console.error('addsudo error:', err);
        await reply(`❌ Error: ${err.message}`);
    }
    break;
}

// ================= DEL SUDO =================
case 'delsudo':
case 'removesudo': {
    if (!isOwner) return reply("❌ Only owners can remove sudo users.");
    if (!args[0]) return reply(`🗑️ Provide the number to remove from sudo.\nExample: delsudo 2547xxxxxxxx`);
    
    try {
        const num = args[0].replace(/[^0-9]/g, '');
        const removed = removeSudo(num);
        if (removed) {
            await reply(`✅ ${num} has been removed from sudo users.`);
        } else {
            await reply(`⚠️ ${num} is not in the sudo list.`);
        }
    } catch (err) {
        console.error('delsudo error:', err);
        await reply(`❌ Error: ${err.message}`);
    }
    break;
}

// ================= LIST SUDO =================
case 'listsudo': {
    if (!isOwner) return reply("❌ Owner only.");
    
    try {
        const sudoList = getSudo();
        if (sudoList.length === 0) return reply("📵 No sudo users added yet.");
        
        let sudoText = `🔑 *Sudo Users (${sudoList.length}):*\n\n`;
        for (const s of sudoList) {
            sudoText += `• *${s}*\n`;
        }
        await reply(sudoText);
    } catch (err) {
        console.error('listsudo error:', err);
        await reply(`❌ Error: ${err.message}`);
    }
    break;
}

// Play-Doc  command
case 'playdoc': {
    try {
        const tempDir = path.join(__dirname, "temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

        if (!args.length) return reply(`🎵 Provide a song name!\nExample: ${command} Not Like Us`);

        const query = args.join(" ");
        if (query.length > 100) return reply(`📝 Song name too long! Max 100 chars.`);

        await reply("🎧 Searching for the track... ⏳");

        const searchResult = await (await yts(`${query} official`)).videos[0];
        if (!searchResult) return reply("😕 Couldn't find that song. Try another one!");

        const video = searchResult;
        const apiUrl = `https://api.privatezia.biz.id/api/downloader/ytmp3?url=${encodeURIComponent(video.url)}`;
        const response = await axios.get(apiUrl);
        const apiData = response.data;

        if (!apiData.status || !apiData.result || !apiData.result.downloadUrl) throw new Error("API failed to fetch track!");

        const timestamp = Date.now();
        const fileName = `audio_${timestamp}.mp3`;
        const filePath = path.join(tempDir, fileName);

        // Download MP3
        const audioResponse = await axios({
            method: "get",
            url: apiData.result.downloadUrl,
            responseType: "stream",
            timeout: 600000
        });

        const writer = fs.createWriteStream(filePath);
        audioResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
        });

        if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0)
            throw new Error("Download failed or empty file!");

        await trashcore.sendMessage(
            from,
            { text: stylishReply(`🎶 Downloaded *${apiData.result.title || video.title}* 🎧`) },
            { quoted: m }
        );

        // Send as document
        await trashcore.sendMessage(
            from,
            {
                document: { url: filePath },
                mimetype: "audio/mpeg",
                fileName: `${(apiData.result.title || video.title).substring(0, 100)}.mp3`
            },
            { quoted: m }
        );

        // Cleanup
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    } catch (error) {
        console.error("Play command error:", error);
        return reply(`💥 Error: ${error.message}`);
    }
    break;
}

case 'antilink': {
    try {
        if (!isGroup) return reply("❌ This command only works in groups!");
        if (!isOwner) return reply("⚠️ Only admins or the owner can use this command!");
    if (!isBotAdmins) return reply("🚫 I need admin privileges to remove members!");

        global.antilink = global.antilink || {};
        const chatId = from;

        if (!global.antilink[chatId]) {
            global.antilink[chatId] = { enabled: false, mode: "delete" }; 
        }

        const option = args[0]?.toLowerCase();

        if (option === "on") {
            global.antilink[chatId].enabled = true;
            return reply(`✅ *Antilink enabled!*\nMode: ${global.antilink[chatId].mode.toUpperCase()}`);
        }

        if (option === "off") {
            global.antilink[chatId].enabled = false;
            return reply("❎ Antilink disabled!");
        }

        if (option === "mode") {
            const modeType = args[1]?.toLowerCase();
            if (!modeType || !["delete", "kick"].includes(modeType))
                return reply("⚙️ Usage: `.antilink mode delete` or `.antilink mode kick`");

            global.antilink[chatId].mode = modeType;
            return reply(`🔧 Antilink mode set to *${modeType.toUpperCase()}*!`);
        }

        // If no argument is given
        return reply(
            `📢 *Antilink Settings*\n\n` +
            `• Status: ${global.antilink[chatId].enabled ? "✅ ON" : "❎ OFF"}\n` +
            `• Mode: ${global.antilink[chatId].mode.toUpperCase()}\n\n` +
            `🧩 Usage:\n` +
            `- .antilink on\n` +
            `- .antilink off\n` +
            `- .antilink mode delete\n` +
            `- .antilink mode kick`
        );
    } catch (err) {
        console.error("Antilink command error:", err);
        reply("💥 Error while updating antilink settings.");
    }
    break;
}

// ================= ANTI TAG=================
case 'antitag': {
    try {
        if (!isGroup) return reply("❌ This command only works in groups!");
        if (!isOwner) return reply("⚠️ Only admins or the owner can use this command!");
        if (!isBotAdmins) return reply("🚫 I need admin privileges to manage group settings!");

        global.antitag = global.antitag || {};
        const chatId = from;

        // Initialize if not existing
        if (!global.antitag[chatId]) {
            global.antitag[chatId] = { enabled: false, mode: "delete" };
        }

        const option = args[0]?.toLowerCase();

        if (option === "on") {
            global.antitag[chatId].enabled = true;
            return reply(`✅ *AntiTag enabled!*\nMode: ${global.antitag[chatId].mode.toUpperCase()}`);
        }

        if (option === "off") {
            global.antitag[chatId].enabled = false;
            return reply("❎ AntiTag disabled!");
        }

        if (option === "mode") {
            const modeType = args[1]?.toLowerCase();
            if (!modeType || !["delete", "kick"].includes(modeType))
                return reply("⚙️ Usage: `.antitag mode delete` or `.antitag mode kick`");

            global.antitag[chatId].mode = modeType;
            return reply(`🔧 AntiTag mode set to *${modeType.toUpperCase()}*!`);
        }

        // If no argument is given
        return reply(
            `📢 *AntiTag Settings*\n\n` +
            `• Status: ${global.antitag[chatId].enabled ? "✅ ON" : "❎ OFF"}\n` +
            `• Mode: ${global.antitag[chatId].mode.toUpperCase()}\n\n` +
            `🧩 Usage:\n` +
            `- .antitag on\n` +
            `- .antitag off\n` +
            `- .antitag mode delete\n` +
            `- .antitag mode kick`
        );
    } catch (err) {
        console.error("AntiTag command error:", err);
        reply("💥 Error while updating AntiTag settings.");
    }
    break;
}

case 'antidemote': {
    try {
        if (!isGroup) return reply("❌ This command only works in groups!");
        if (!isOwner) return reply("⚠️ Only admins or the owner can use this command!");
        if (!isBotAdmins) return reply("🚫 I need admin privileges to manage group settings!");

        global.antidemote = global.antidemote || {};
        const chatId = from;

        if (!global.antidemote[chatId]) {
            global.antidemote[chatId] = { enabled: false, mode: "revert" };
        }

        const option = args[0]?.toLowerCase();

        if (option === "on") {
            global.antidemote[chatId].enabled = true;
            return reply(`✅ *AntiDemote enabled!*\nMode: ${global.antidemote[chatId].mode.toUpperCase()}`);
        }

        if (option === "off") {
            global.antidemote[chatId].enabled = false;
            return reply("❎ AntiDemote disabled!");
        }

        if (option === "mode") {
            const modeType = args[1]?.toLowerCase();
            if (!modeType || !["revert", "kick"].includes(modeType))
                return reply("⚙️ Usage: `.antidemote mode revert` or `.antidemote mode kick`");

            global.antidemote[chatId].mode = modeType;
            return reply(`🔧 AntiDemote mode set to *${modeType.toUpperCase()}*!`);
        }

        // Display settings if no args
        return reply(
            `📢 *AntiDemote Settings*\n\n` +
            `• Status: ${global.antidemote[chatId].enabled ? "✅ ON" : "❎ OFF"}\n` +
            `• Mode: ${global.antidemote[chatId].mode.toUpperCase()}\n\n` +
            `🧩 Usage:\n` +
            `- .antidemote on\n` +
            `- .antidemote off\n` +
            `- .antidemote mode revert\n` +
            `- .antidemote mode kick`
        );
    } catch (err) {
        console.error("AntiDemote command error:", err);
        reply("💥 Error while updating AntiDemote settings.");
    }
    break;
}

case 'antipromote': {
    try {
        if (!isGroup) return reply("❌ This command only works in groups!");
        if (!isOwner) return reply("⚠️ Only admins or the owner can use this command!");
        if (!isBotAdmins) return reply("🚫 I need admin privileges to manage group settings!");

        global.antipromote = global.antipromote || {};
        const chatId = from;

        if (!global.antipromote[chatId]) {
            global.antipromote[chatId] = { enabled: false, mode: "revert" }; 
        }

        const option = args[0]?.toLowerCase();

        if (option === "on") {
            global.antipromote[chatId].enabled = true;
            return reply(`✅ *AntiPromote enabled!*\nMode: ${global.antipromote[chatId].mode.toUpperCase()}`);
        }

        if (option === "off") {
            global.antipromote[chatId].enabled = false;
            return reply("❎ AntiPromote disabled!");
        }

        if (option === "mode") {
            const modeType = args[1]?.toLowerCase();
            if (!modeType || !["revert", "kick"].includes(modeType))
                return reply("⚙️ Usage: `.antipromote mode revert` or `.antipromote mode kick`");

            global.antipromote[chatId].mode = modeType;
            return reply(`🔧 AntiPromote mode set to *${modeType.toUpperCase()}*!`);
        }

        // Display settings if no args
        return reply(
            `📢 *AntiPromote Settings*\n\n` +
            `• Status: ${global.antipromote[chatId].enabled ? "✅ ON" : "❎ OFF"}\n` +
            `• Mode: ${global.antipromote[chatId].mode.toUpperCase()}\n\n` +
            `🧩 Usage:\n` +
            `- .antipromote on\n` +
            `- .antipromote off\n` +
            `- .antipromote mode revert\n` +
            `- .antipromote mode kick`
        );
    } catch (err) {
        console.error("AntiPromote command error:", err);
        reply("💥 Error while updating AntiPromote settings.");
    }
    break;
}

case 'antibadword': {
  try {
    if (!isGroup) return reply("❌ This command only works in groups!");
    if (!isOwner) return reply("⚠️ Only admins or the owner can use this command!");

    global.antibadword = global.antibadword || {};
    const chatId = from;

    if (!global.antibadword[chatId]) {
      global.antibadword[chatId] = {
        enabled: false,
        words: [],
        warnings: {} // { userJid: count }
      };
    }

    const option = args[0]?.toLowerCase();

    // Enable AntiBadWord
    if (option === "on") {
      global.antibadword[chatId].enabled = true;
      return reply("✅ *AntiBadWord enabled!* Bad words will now be deleted and warned.");
    }

    // Disable AntiBadWord
    if (option === "off") {
      global.antibadword[chatId].enabled = false;
      return reply("❎ AntiBadWord disabled!");
    }

    // Add bad word
    if (option === "add") {
      const word = args.slice(1).join(" ").toLowerCase();
      if (!word) return reply("⚙️ Usage: `.antibadword add <word>`");
      if (global.antibadword[chatId].words.includes(word))
        return reply("⚠️ That word is already in the list.");

      global.antibadword[chatId].words.push(word);
      return reply(`✅ Added bad word: *${word}*`);
    }

    // Remove bad word
    if (option === "remove") {
      const word = args.slice(1).join(" ").toLowerCase();
      if (!word) return reply("⚙️ Usage: `.antibadword remove <word>`");
      const index = global.antibadword[chatId].words.indexOf(word);
      if (index === -1) return reply("❌ That word is not in the list.");
      global.antibadword[chatId].words.splice(index, 1);
      return reply(`🗑️ Removed bad word: *${word}*`);
    }

    // List bad words
    if (option === "list") {
      const words = global.antibadword[chatId].words;
      return reply(
        `📜 *AntiBadWord List*\n` +
        `Status: ${global.antibadword[chatId].enabled ? "✅ ON" : "❎ OFF"}\n\n` +
        (words.length ? words.map((w, i) => `${i + 1}. ${w}`).join('\n') : "_No words added yet_")
      );
    }

    // Reset warnings
    if (option === "reset") {
      global.antibadword[chatId].warnings = {};
      return reply("🧹 All user warnings have been reset!");
    }

    // Default info
    return reply(
      `🧩 *AntiBadWord Settings*\n\n` +
      `• Status: ${global.antibadword[chatId].enabled ? "✅ ON" : "❎ OFF"}\n` +
      `• Words: ${global.antibadword[chatId].words.length}\n\n` +
      `🧰 Usage:\n` +
      `- .antibadword on/off\n` +
      `- .antibadword add <word>\n` +
      `- .antibadword remove <word>\n` +
      `- .antibadword list\n` +
      `- .antibadword reset`
    );

  } catch (err) {
    console.error("AntiBadWord command error:", err);
    reply("💥 Error while updating AntiBadWord settings.");
  }
  break;
}
case 'add': {
    if (!isGroup) return reply(" this command is only for groups");
    if (!isAdmin && !isBotAdmins && !isOwner) return reply("action restricted for admin and owner only");

    if (!text && !m.quoted) {
        return reply(`_Example:_\n\n${command} 2547xxxxxxx`);
    }

    const numbersOnly = text
        ? text.replace(/\D/g, '') + '@s.whatsapp.net'
        : m.quoted?.sender;

    try {
        const res = await trashcore.groupParticipantsUpdate(from, [numbersOnly], 'add');
        for (let i of res) {
            const invv = await trashcore.groupInviteCode(from);

            if (i.status == 408) return reply(`❌ User is already in the group.`);
            if (i.status == 401) return reply(`🚫 Bot is blocked by the user.`);
            if (i.status == 409) return reply(`⚠️ User recently left the group.`);
            if (i.status == 500) return reply(`❌ Invalid request. Try again later.`);

            if (i.status == 403) {
                await trashcore.sendMessage(
                    from,
                    {
                        text: `@${numbersOnly.split('@')[0]} cannot be added because their account is private.\nAn invite link will be sent to their private chat.`,
                        mentions: [numbersOnly],
                    },
                    { quoted: m }
                );

                await trashcore.sendMessage(
                    numbersOnly,
                    {
                        text: `🌐 *Group Invite:*\nhttps://chat.whatsapp.com/${invv}\n━━━━━━━━━━━━━━━\n👑 Admin: wa.me/${m.sender.split('@')[0]}\n📩 You have been invited to join this group.`,
                        detectLink: true,
                        mentions: [numbersOnly],
                    },
                    { quoted: m }
                ).catch((err) => reply('❌ Failed to send invitation! 😔'));
            } else {
                reply('✅ User added successfully!');
            }
        }
    } catch (e) {
        console.error(e);
        reply('⚠️ Could not add user! 😢');
    }
    break;
}

// --- HIDETAG COMMAND ---
case 'hidetag': {
    if (!isGroup) return reply('❌ This command can only be used in groups!');
    if (!args || args.length === 0) return reply('❌ Please provide a message to hidetag!');

    try {
        const _htMeta = groupMeta;
        const participants = _htMeta ? _htMeta.participants.map(p => p.id) : [];

        const text = args.join(' ');
        await trashcore.sendMessage(from, { text, mentions: participants });
    } catch (err) {
        console.error('[HIDETAG ERROR]', err);
        reply('❌ Failed to hidetag, please try again.');
    }
    break;
}

case 'tagall':
case 'everyone':
    if (!isGroup) {
        return await trashcore.sendMessage(from, { text: '❌ This command can only be used in groups!' });
    }

    const _taParticipants = groupMeta ? groupMeta.participants.map(p => p.id) : [];

    let messageText = `👥 Tagging everyone in the group!\n\n`;
    _taParticipants.forEach((p, i) => {
        messageText += `• @${p.split('@')[0]}\n`;
    });

    await trashcore.sendMessage(from, {
        text: messageText,
        mentions: _taParticipants
    });
break;


case 'kick':
case 'remove': {
    if (!isGroup) return reply("❌ This command can only be used in groups!");
    if (!isAdmin && !isOwner) return reply("⚠️ Only admins or the owner can use this command!");
    if (!isBotAdmins) return reply("🚫 I need admin privileges to remove members!");

    // 🧩 Identify target user
    let target;
    if (m.mentionedJid?.[0]) {
        target = m.mentionedJid[0];
    } else if (m.quoted?.sender) {
        target = m.quoted.sender;
    } else if (args[0]) {
        const number = args[0].replace(/[^0-9]/g, '');
        if (!number) return reply(`⚠️ Example:\n${command} 254712345678`);
        target = `${number}@s.whatsapp.net`;
    } else {
        return reply(`⚠️ Example:\n${command} 254712345678`);
    }

    // 🛡️ Protect owner & bot
    const botNumber = trashcore.user?.id || '';
    const ownerNumber = (config.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
    const ownerJid = ownerNumber ? `${ownerNumber}@s.whatsapp.net` : '';

    if (target === botNumber) return reply("😅 I can’t remove myself!");
    if (target === ownerJid) return reply("🚫 You can’t remove my owner!");

    try {
        // Add a timeout wrapper
        const result = await Promise.race([
            trashcore.groupParticipantsUpdate(from, [target], 'remove'),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)) // 10s timeout
        ]);

        if (result && !result[0]?.status) {
            await reply(`✅ Successfully removed @${target.split('@')[0]}`, { mentions: [target] });
        } else {
            reply("⚠️ Couldn’t remove this user. Maybe they’re the group creator.");
        }

    } catch (err) {
        if (err.message === 'timeout') {
            reply("⏱️ WhatsApp took too long to respond. Try again in a few seconds.");
        } else {
            console.error("Kick Error:", err);
            reply("❌ Failed to remove member. Possibly due to permission issues or socket lag.");
        }
    }

    break;
}

case 'promote': {
    try {
        if (!m.isGroup) return m.reply("❌ This command only works in groups!");

        const _promMeta = groupMeta || {};
        const participants = _promMeta.participants || [];

        // Extract all admins (numbers only for reliability)
        const groupAdmins = participants
            .filter(p => p.admin !== null)
            .map(p => p.id.replace(/[^0-9]/g, ''));

        const senderNumber = m.sender.replace(/[^0-9]/g, '');
        const botNumber = (trashcore.user?.id || '').replace(/[^0-9]/g, '');

        const isSenderAdmin = groupAdmins.includes(senderNumber);
            if (!isAdmin && !isOwner) return reply("⚠️ Only admins or the owner can use this command!");
    if (!isBotAdmins) return reply("🚫 I need admin privileges to remove members!");

        // Get target user (from mention or quoted)
        let target;
        if (m.mentionedJid?.length) {
            target = m.mentionedJid[0];
        } else if (m.quoted && m.quoted.key.participant) {
            target = m.quoted.key.participant;
        } else {
            return reply("👤 Mention or reply to the user you want to promote.");
        }

        const targetNumber = target.replace(/[^0-9]/g, '');
        if (groupAdmins.includes(targetNumber))
            return reply("👑 That user is already an admin!");

        await trashcore.groupParticipantsUpdate(m.chat, [target], "promote");

        const userName = participants.find(p => p.id === target)?.notify || target.split('@')[0];
        await trashcore.sendMessage(m.chat, {
            text: `🎉 *${userName}* has been promoted to admin! 👑`
        }, { quoted: m });

    } catch (error) {
        console.error("Promote command error:", error);
        return reply(`💥 Error: ${error.message}`);
    }
    break;
}



case 'demote': {
    try {
        if (!m.isGroup) return reply("❌ This command only works in groups!");

        const _demMeta = groupMeta || {};
        const participants = _demMeta.participants || [];

        // Extract admin JIDs (keep full IDs)
        const groupAdmins = participants
            .filter(p => p.admin)
            .map(p => p.id);

        const senderJid = m.sender;
        const botJid = trashcore.user?.id || '';

        const isSenderAdmin = groupAdmins.includes(senderJid);
        const isBotAdmin = groupAdmins.includes(botJid);

        if (!isAdmin && !isOwner) return reply("⚠️ Only admins or the owner can use this command!");
    if (!isBotAdmins) return reply("🚫 I need admin privileges to remove members!");

        // Get target (mention or reply)
        let target;
        if (m.mentionedJid?.length) {
            target = m.mentionedJid[0];
        } else if (m.quoted && m.quoted.sender) {
            target = m.quoted.sender;
        } else {
            return reply("👤 Mention or reply to the user you want to demote.");
        }

        if (!groupAdmins.includes(target))
            return reply("👤 That user is not an admin.");

        await trashcore.groupParticipantsUpdate(m.chat, [target], "demote");

        const userName = participants.find(p => p.id === target)?.notify || target.split('@')[0];
        await trashcore.sendMessage(m.chat, {
            text: `😔 *${userName}* has been demoted from admin.`
        }, { quoted: m });

    } catch (error) {
        console.error("Demote command error:", error);
        return reply(`💥 Error: ${error.message}`);
    }
    break;
}

case 'copilot': {
    try {
        if (!args[0]) return reply('⚠️ Please provide a query!\n\nExample:\n.copilot what is JavaScript?');
        
        const query = encodeURIComponent(args.join(' '));
        const response = await fetch(`https://api.nekolabs.my.id/ai/copilot?text=${query}`);
        const data = await response.json();
        
        if (data?.result?.text) {
            await reply(data.result.text);
        } else {
            await reply("❌ Failed to get a response from the AI.");
        }

    } catch (err) {
        console.error("Copilot command error:", err);
        await reply(`❌ Error: ${err.message}`);
    }
    break;
}


            // ================= OWNER ONLY COMMANDS =================
            default: {
                if (!isOwner) break; // Only owner can use eval/exec

                try {
                    const code = body.trim();

                    // Async eval with <>
                    if (code.startsWith('<')) {
                        const js = code.slice(1);
                        const output = await eval(`(async () => { ${js} })()`);
                        await reply(typeof output === 'string' ? output : JSON.stringify(output, null, 4));
                    } 
                    // Sync eval with >
                    else if (code.startsWith('>')) {
                        const js = code.slice(1);
                        let evaled = await eval(js);
                        if (typeof evaled !== 'string') evaled = util.inspect(evaled, { depth: 0 });
                        await reply(evaled);
                    } 
                    // Shell exec with $
                    else if (code.startsWith('$')) {
                        const cmd = code.slice(1);
                        exec(cmd, (err, stdout, stderr) => {
                            if (err) return reply(`❌ Error:\n${err.message}`);
                            if (stderr) return reply(`⚠️ Stderr:\n${stderr}`);
                            if (stdout) return reply(`✅ Output:\n${stdout}`);
                        });
                    }
                } catch (err) {
                    console.error("Owner eval/exec error:", err);
                    await reply(`❌ Eval/Exec failed:\n${err.message}`);
                }

                break;
            }
        }
    } catch (err) {
        console.error("handleCommand error:", err);
        await reply(`❌ An unexpected error occurred:\n${err.message}`);
    }
};

// =============== HOT RELOAD ===============
// Note: hot-reload is managed by index.js, not needed here