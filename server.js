require('dotenv').config();

const express = require('express');
const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
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

    try {
        // 🔴 이 모델 알림 끄기 — mute, update the original message
        if (interaction.customId.startsWith('mute_')) {
            const modelName = decodeURIComponent(interaction.customId.slice(5));
            mutedList.add(modelName);
            await interaction.update({
                content:    `🔇 **\`${modelName}\`** 알림이 꺼졌습니다.`,
                embeds:     [],
                components: [],
            });
            console.log(`[MUTE] ${modelName}`);
            return;
        }

        // 🟢 알람 켜기 — unmute, ephemeral reply so chat stays clean
        if (interaction.customId.startsWith('unmute_')) {
            const modelName = decodeURIComponent(interaction.customId.slice(7));
            mutedList.delete(modelName);
            await interaction.reply({
                content:   `🔔 **\`${modelName}\`** 알림이 다시 켜졌습니다.`,
                ephemeral: true,
            });
            console.log(`[UNMUTE] ${modelName}`);
            return;
        }

        // 🔘 끈 알람 목록 — show muted list as ephemeral reply
        if (interaction.customId === 'showmuted') {
            const list = [...mutedList];
            const body  = list.length
                ? list.map((n, i) => `${i + 1}. \`${n}\``).join('\n')
                : '뮤트된 모델이 없습니다.';
            await interaction.reply({
                content:   `**🔇 뮤트된 모델 목록 (${list.length}개):**\n${body}`,
                ephemeral: true,
            });
            return;
        }
    } catch (e) {
        console.error('Interaction error:', e.message);
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
    const { modelName, sign, luck, time, serverLink } = req.body || {};

    if (!modelName) {
        return res.status(400).json({ error: 'modelName is required' });
    }

    if (mutedList.has(modelName)) {
        return res.json({ sent: false, reason: 'muted' });
    }

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) throw new Error('Channel not found');

        // Discord customId has a 100-char limit; prefix is 7 chars ("unmute_")
        const safeId  = encodeURIComponent(modelName).slice(0, 85);
        const muteRow = new ActionRowBuilder().addComponents(
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

        const fields = [
            { name: '모델명', value: `\`${modelName}\``, inline: true },
            { name: 'Sign',   value: sign || 'N/A',        inline: true },
            { name: 'Luck',   value: luck || 'N/A',        inline: true },
        ];

        const link = serverLink && String(serverLink).trim();
        if (link) {
            fields.push({
                name: 'Server',
                value: link.startsWith('http') ? `[Join Server](${link})` : link,
                inline: true,
            });
        }

        fields.push({ name: '시각', value: time || 'N/A', inline: false });

        await channel.send({
            content: '@everyone',
            embeds: [{
                title: '새로운 모델이 생성되었습니다!',
                color: 0xFF4444,
                fields,
            }],
            components: [muteRow],
        });

        console.log(`[NOTIFY] Sent: ${modelName}${link ? ` (link=${link})` : ''}`);
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
