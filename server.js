const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const app = express();

let disabledModels = [];

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

app.use(express.json());

// 헬스체크용 경로 (Render 서버가 꺼지지 않게 유지해 줍니다)
app.get('/', (req, res) => {
    res.send('Server is running!');
});

app.post('/send-alert', (req, res) => {
    const { modelName, channelId } = req.body;
    
    if (!modelName || !channelId) {
        return res.status(400).json({ error: "Missing parameters" });
    }

    if (disabledModels.includes(modelName)) {
        return res.json({ success: false, reason: "Blocked" });
    }

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`disable_${modelName}`)
                .setLabel('이 모델 알림 끄기')
                .setStyle(ButtonStyle.Danger)
        );

    const channel = client.channels.cache.get(channelId);
    if (channel) {
        channel.send({
            content: `🆕 **새로운 모델이 생성되었습니다!**\n모델명: \`${modelName}\``,
            components: [row]
        });
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Channel not found" });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('disable_')) {
        const modelName = interaction.customId.replace('disable_', '');

        if (!disabledModels.includes(modelName)) {
            disabledModels.push(modelName);
        }

        await interaction.update({
            content: `⚠️ **${modelName}** 모델의 알림이 비활성화되었습니다.`,
            components: []
        });
    }
});

client.login(process.env.DISCORD_TOKEN);
client.once('ready', () => { console.log(`Bot logged in: ${client.user.tag}`); });

// Render는 PORT 환경 변수를 자동으로 주입하므로 0.0.0.0 호스트 설정이 필요합니다.
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
