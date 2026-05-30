require('dotenv').config();

const express = require('express');
const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');

const app = express();
app.use(express.json());

const BOT_TOKEN  = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
    console.error('Missing DISCORD_TOKEN or CHANNEL_ID in environment variables');
    process.exit(1);
}

// In-memory muted list (persists while server is running)
let mutedList = new Set();

function safeEncodeModelId(modelName) {
    return encodeURIComponent(modelName).slice(0, 85);
}

function safeDecodeModelId(encoded) {
    try {
        return decodeURIComponent(encoded);
    } catch {
        return encoded;
    }
}

function buildNotifyButtons(modelName) {
    const safeId = safeEncodeModelId(modelName);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`mute_${safeId}`)
            .setLabel('이 모델 알림 끄기')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`unmute_${safeId}`)
            .setLabel('알람 켜기')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('showmuted')
            .setLabel('끈 알람 목록')
            .setStyle(ButtonStyle.Secondary)
    );
}

function buildMutedActionRow(modelName) {
    const safeId = safeEncodeModelId(modelName);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`unmute_${safeId}`)
            .setLabel('알람 켜기')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('showmuted')
            .setLabel('끈 알람 목록')
            .setStyle(ButtonStyle.Secondary)
    );
}

function buildMutedListRows() {
    const rows = [];
    let current = [];

    for (const name of mutedList) {
        if (current.length >= 5) {
            rows.push(new ActionRowBuilder().addComponents(...current));
            current = [];
            if (rows.length >= 4) break;
        }
        const label = name.length > 80 ? name.slice(0, 77) + '...' : name;
        current.push(
            new ButtonBuilder()
                .setCustomId(`unmute_${safeEncodeModelId(name)}`)
                .setLabel(label)
                .setStyle(ButtonStyle.Success)
        );
    }

    if (current.length > 0 && rows.length < 5) {
        rows.push(new ActionRowBuilder().addComponents(...current));
    }

    return rows;
}

async function replyError(interaction, message) {
    const payload = {
        content: message,
        flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
    } else {
        await interaction.reply(payload);
    }
}

// ==========================================
// Discord Client
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', () => {
    console.log(`Discord bot ready: ${client.user.tag}`);
});

// Button interaction handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const id = interaction.customId;

    try {
        // 🟢 알람 켜기 — check BEFORE mute_ (safe order)
        if (id.startsWith('unmute_')) {
            const modelName = safeDecodeModelId(id.slice(7));
            mutedList.delete(modelName);
            await interaction.update({
                content: '@everyone',
                embeds: [{
                    title: '🔔 알림이 다시 켜졌습니다!',
                    description: `**\`${modelName}\`** 모델 알림이 활성화되었습니다.`,
                    color: 0x44AA44,
                }],
                components: [buildNotifyButtons(modelName)],
            });
            console.log(`[UNMUTE] ${modelName}`);
            return;
        }

        // 🔴 이 모델 알림 끄기 — keep unmute button on message
        if (id.startsWith('mute_')) {
            const modelName = safeDecodeModelId(id.slice(5));
            mutedList.add(modelName);
            await interaction.update({
                content: '@everyone',
                embeds: [{
                    title: '🔇 알림이 꺼졌습니다',
                    description: `**\`${modelName}\`** 모델 알림이 꺼졌습니다.\n아래 **알람 켜기** 버튼으로 다시 켤 수 있습니다.`,
                    color: 0x888888,
                }],
                components: [buildMutedActionRow(modelName)],
            });
            console.log(`[MUTE] ${modelName}`);
            return;
        }

        // 🔘 끈 알람 목록 — list + per-model unmute buttons
        if (id === 'showmuted') {
            const list = [...mutedList];
            const body = list.length
                ? list.map((n, i) => `${i + 1}. \`${n}\``).join('\n')
                : '뮤트된 모델이 없습니다.';
            const rows = buildMutedListRows();
            await interaction.reply({
                content:   `**🔇 뮤트된 모델 목록 (${list.length}개):**\n${body}`,
                components: rows,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
    } catch (e) {
        console.error('Interaction error:', e);
        try {
            await replyError(interaction, '❌ 처리 중 오류가 발생했습니다. 다시 시도해주세요.');
        } catch (_) {}
    }
});

// Discord text commands
client.on('messageCreate', async msg => {
    if (msg.author.bot) return;

    const text = msg.content.trim();

    // !mutelist — show all muted models
    if (text === '!mutelist') {
        const list = [...mutedList];
        const body = list.length
            ? list.map((n, i) => `${i + 1}. \`${n}\``).join('\n')
            : '없음';
        await msg.reply(`**🔇 뮤트된 모델 목록 (${list.length}개):**\n${body}`);
        return;
    }

    // !mute <name> — manually mute a model
    if (text.startsWith('!mute ')) {
        const name = text.slice(6).trim();
        if (!name) { await msg.reply('Usage: `!mute 모델명`'); return; }
        mutedList.add(name);
        await msg.reply(`🔇 **\`${name}\`** 알림이 꺼졌습니다.`);
        return;
    }

    // !unmute <name> — unmute a model
    if (text.startsWith('!unmute ')) {
        const name = text.slice(8).trim();
        if (!name) { await msg.reply('Usage: `!unmute 모델명`'); return; }
        mutedList.delete(name);
        await msg.reply(`🔔 **\`${name}\`** 알림이 다시 켜졌습니다.`);
        return;
    }

    // !clearall — clear all muted models
    if (text === '!clearall') {
        mutedList.clear();
        await msg.reply('✅ 뮤트 목록이 전부 초기화되었습니다.');
        return;
    }

    // !help — show available commands
    if (text === '!help') {
        await msg.reply(
            '**[Commands]**\n'
            + '`!mutelist` — 뮤트된 모델 목록 보기\n'
            + '`!mute <name>` — 모델 알림 끄기\n'
            + '`!unmute <name>` — 모델 알림 켜기\n'
            + '`!clearall` — 전체 뮤트 초기화'
        );
    }
});

client.login(BOT_TOKEN);

// ==========================================
// REST API
// ==========================================

// Health check
app.get('/', (_, res) => res.json({ status: 'ok' }));

/**
 * POST /notify
 * Called by Roblox when a new entity model spawns.
 * Body: { modelName, sign, luck, time }
 */
app.post('/notify', async (req, res) => {
    const { modelName, sign, luck, time } = req.body || {};

    if (!modelName) {
        return res.status(400).json({ error: 'modelName is required' });
    }

    if (mutedList.has(modelName)) {
        return res.json({ sent: false, reason: 'muted' });
    }

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) throw new Error('Channel not found');

        const muteRow = buildNotifyButtons(modelName);

        await channel.send({
            content: '@everyone',
            embeds: [{
                title: '새로운 모델이 생성되었습니다!',
                color: 0xFF4444,
                fields: [
                    { name: '모델명', value: `\`${modelName}\``,  inline: true  },
                    { name: 'Sign',   value: sign || 'N/A',        inline: true  },
                    { name: 'Luck',   value: luck || 'N/A',        inline: true  },
                    { name: '시각',   value: time || 'N/A',        inline: false },
                ],
            }],
            components: [muteRow],
        });

        console.log(`[NOTIFY] Sent: ${modelName}`);
        res.json({ sent: true });
    } catch (e) {
        console.error('notify error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /muted-list
 * Polled by Roblox every 30 s to sync the blocked-names list.
 */
app.get('/muted-list', (_, res) => {
    res.json({ muted: [...mutedList] });
});

/**
 * POST /unmute
 * Body: { modelName }
 */
app.post('/unmute', (req, res) => {
    const { modelName } = req.body || {};
    if (!modelName) return res.status(400).json({ error: 'modelName required' });
    mutedList.delete(modelName);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
