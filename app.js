const { 
  Client, GatewayIntentBits, SlashCommandBuilder, Routes, REST, 
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  Events, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelType,
  AttachmentBuilder // Tambahan: Import AttachmentBuilder
} = require("discord.js");

// 1. IMPORT LIBRARY YANG BENAR
const { GoogleSpreadsheet } = require('google-spreadsheet'); 
const { JWT } = require('google-auth-library');
const Canvas = require('canvas'); // Tambahan: Import Canvas

/* ================= CONFIGURATION ================= */
// 2. LOAD FILE JSON KREDENSIAL
const creds = require('./google-credentials.json'); 

const CONFIG = {
  // ⚠️ MASUKKAN TOKEN DISCORD BARU KAMU DI BAWAH INI
  TOKEN: "Token", 
  CLIENT_ID: "Client_ID",
  GUILD_ID: "Guild_ID",
  SPREADSHEET_ID: "",
  DEBUG: true
};

/* ================= STATE MANAGEMENT ================= */
const tasks = new Map();  
const points = new Map(); 
const availableTitles = new Map();
const availableRoles = new Map(); 

let activeLogChannelId = null;
let activeReminderChannelId = null;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* ================= SPREADSHEET MANAGER ================= */
const serviceAccountAuth = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: [''],
});

const doc = new GoogleSpreadsheet(CONFIG.SPREADSHEET_ID, serviceAccountAuth);

async function initSpreadsheet() {
  try {
    await doc.loadInfo();
    console.log(`✅ Terhubung ke Spreadsheet: ${doc.title}`);
    
    // 1. LOAD: Points
    let sheetPoints = doc.sheetsByTitle['Points'];
    if (!sheetPoints) sheetPoints = await doc.addSheet({ title: 'Points', headerValues: ['UserID', 'Points', 'Username'] });
    points.clear(); 
    const rowsP = await sheetPoints.getRows();
    rowsP.forEach(row => points.set(row.get('UserID'), parseInt(row.get('Points')) || 0));

    // 2. LOAD: Judul
    let sheetJudul = doc.sheetsByTitle['Judul'];
    if (!sheetJudul) { sheetJudul = await doc.addSheet({ title: 'Judul', headerValues: ['ID', 'Nama'] }); }
    availableTitles.clear(); 
    const rowsJ = await sheetJudul.getRows();
    rowsJ.forEach(row => {
        if(row.get('ID') && row.get('Nama')) availableTitles.set(row.get('ID'), row.get('Nama'));
    });

    // 3. LOAD: Role
    let sheetRole = doc.sheetsByTitle['Role'];
    if (!sheetRole) { sheetRole = await doc.addSheet({ title: 'Role', headerValues: ['Nama Role', 'id role'] }); }
    availableRoles.clear();
    const rowsR = await sheetRole.getRows();
    rowsR.forEach(row => {
        if(row.get('Nama Role') && row.get('id role')) availableRoles.set(row.get('id role'), row.get('Nama Role'));
    });

    // 4. LOAD: Tasks
    let sheetTasks = doc.sheetsByTitle['Tasks'];
    if (!sheetTasks) sheetTasks = await doc.addSheet({ title: 'Tasks', headerValues: ['TaskID', 'Title', 'Description', 'Deadline', 'Points', 'Buttons', 'Ringkasan', 'DataState'] });
    
    tasks.clear(); 
    const rowsT = await sheetTasks.getRows();
    rowsT.forEach(row => {
      const state = JSON.parse(row.get('DataState') || '{}');
      const duration = parseInt(row.get('Deadline')); 
      
      const labels = JSON.parse(row.get('Buttons') || '[]');
      const completed = state.completed || [];

      if (completed.length < labels.length) {
        tasks.set(row.get('TaskID'), {
          id: row.get('TaskID'),
          title: row.get('Title'),
          originalDesc: row.get('Description'),
          duration: duration, 
          pointValue: parseInt(row.get('Points')),
          labels: labels,
          takenBy: state.takenBy || {},
          finishedBy: state.finishedBy || {},
          completed: completed,
          channelId: state.channelId,
          deadlines: state.deadlines || {}, 
          remindedLevels: state.remindedLevels || {}, 
          roleId: state.roleId
        });
      }
    });

    // 5. LOAD: Settings
    let sheetSettings = doc.sheetsByTitle['Settings'];
    if (!sheetSettings) sheetSettings = await doc.addSheet({ title: 'Settings', headerValues: ['Key', 'Value'] });
    const rowsS = await sheetSettings.getRows();
    
    const logRow = rowsS.find(r => r.get('Key') === 'LOG_CHANNEL_ID');
    if (logRow && logRow.get('Value')) activeLogChannelId = logRow.get('Value');

    const remRow = rowsS.find(r => r.get('Key') === 'REMINDER_CHANNEL_ID');
    if (remRow && remRow.get('Value')) activeReminderChannelId = remRow.get('Value');

    console.log(`✅ Data Loaded: ${points.size} Users, ${tasks.size} Active Tasks.`);

  } catch (err) { console.error("❌ Gagal connect Spreadsheet:", err); }
}

function generateHumanSummary(taskData) {
  let lines = [];
  taskData.labels.forEach((label, idx) => {
    const idxStr = idx.toString();
    if (taskData.completed.includes(idxStr)) {
      const user = taskData.finishedBy[idxStr] || "Unknown";
      lines.push(`${label}: ${user} (Selesai)`);
    } else if (taskData.takenBy[idxStr]) {
      const user = taskData.takenBy[idxStr];
      const ddl = taskData.deadlines[idxStr];
      const sisa = ddl ? Math.floor((ddl - Date.now())/60000) + "m" : "?";
      lines.push(`${label}: ${user} (Proses, Sisa: ${sisa})`);
    } else {
      lines.push(`${label}: -`);
    }
  });
  return lines.join("\n");
}

async function sendLog(title, description, color = "Blue", components = []) {
    try {
        if (!activeLogChannelId) return console.log("⚠️ Log gagal kirim: Channel Log belum diset.");
        const channel = client.channels.cache.get(activeLogChannelId);
        if (!channel) return;
        const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
        await channel.send({ embeds: [embed], components: components });
    } catch (e) { console.error("Gagal kirim log:", e); }
}

async function savePointToSheet(userId, username, newScore) {
  try {
    const sheet = doc.sheetsByTitle['Points'];
    const rows = await sheet.getRows();
    const existingRow = rows.find(row => row.get('UserID') === userId);
    if (existingRow) { existingRow.assign({ Points: newScore, Username: username }); await existingRow.save(); } 
    else { await sheet.addRow({ UserID: userId, Points: newScore, Username: username }); }
  } catch (e) { console.error("Error Save Point:", e); }
}

async function saveTaskToSheet(taskData) {
  try {
    const sheet = doc.sheetsByTitle['Tasks'];
    const state = JSON.stringify({ 
      takenBy: taskData.takenBy, finishedBy: taskData.finishedBy,
      completed: taskData.completed, channelId: taskData.channelId, 
      deadlines: taskData.deadlines, 
      remindedLevels: taskData.remindedLevels, 
      roleId: taskData.roleId
    });
    const summary = generateHumanSummary(taskData);
    await sheet.addRow({
      TaskID: taskData.id, Title: taskData.title, Description: taskData.originalDesc, 
      Deadline: taskData.duration, 
      Points: taskData.pointValue, Buttons: JSON.stringify(taskData.labels), Ringkasan: summary, DataState: state
    });
  } catch (e) { console.error("Error Save Task:", e); }
}

async function updateTaskInSheet(taskData) {
  try {
    const sheet = doc.sheetsByTitle['Tasks'];
    const rows = await sheet.getRows();
    const row = rows.find(r => r.get('TaskID') === taskData.id);
    if (row) {
      const state = JSON.stringify({
        takenBy: taskData.takenBy, finishedBy: taskData.finishedBy, completed: taskData.completed, 
        channelId: taskData.channelId, 
        deadlines: taskData.deadlines, 
        remindedLevels: taskData.remindedLevels,
        roleId: taskData.roleId
      });
      const summary = generateHumanSummary(taskData);
      row.assign({ DataState: state, Ringkasan: summary });
      await row.save();
    }
  } catch (e) { console.error("Error Update Task:", e); }
}

async function deleteTaskFromSheet(taskId) {
  try {
    const sheet = doc.sheetsByTitle['Tasks'];
    const rows = await sheet.getRows();
    const row = rows.find(r => r.get('TaskID') === taskId);
    if (row) await row.delete();
  } catch (e) { console.error("Error Delete Task:", e); }
}

async function saveSettingsToSheet(key, value) {
    try {
        const sheet = doc.sheetsByTitle['Settings'];
        const rows = await sheet.getRows();
        const existingRow = rows.find(r => r.get('Key') === key);
        if (existingRow) { existingRow.assign({ Value: value }); await existingRow.save(); } 
        else { await sheet.addRow({ Key: key, Value: value }); }
    } catch (e) { console.error("Gagal simpan setting:", e); }
}

/* 🔥 CHECKER LOOP: INDIVIDUAL DEADLINES 🔥 */
async function checkReminders() {
    const now = Date.now();
    const thresholds = [5, 10, 15]; 

    for (const [taskId, task] of tasks) {
        for (const [idxStr, userId] of Object.entries(task.takenBy)) {
            const userDeadline = task.deadlines[idxStr];
            if (!userDeadline) continue; 

            const timeDiff = userDeadline - now;
            const minutesLeft = Math.floor(timeDiff / 60000);
            
            if (!task.remindedLevels[idxStr]) task.remindedLevels[idxStr] = [];

            // --- 1. REMINDER (Sisa 15, 10, 5 Menit) ---
            if (minutesLeft > 0) {
                for (const t of thresholds) {
                    if (minutesLeft <= t && !task.remindedLevels[idxStr].includes(t)) {
                        
                        if (activeReminderChannelId) {
                            const remChannel = client.channels.cache.get(activeReminderChannelId);
                            if (remChannel) {
                                const msgContent = `⚠️ **REMINDER: ${t} Menit Lagi!**\nTarget: <@${userId}>\nBagian: **${task.labels[idxStr]}**\n\nSegera selesaikan tugas: **${task.title}**\n[➡️ Klik untuk ke tugas](https://discord.com/channels/${CONFIG.GUILD_ID}/${task.channelId}/${task.id})`;
                                await remChannel.send(msgContent).catch(console.error);
                            }
                        }

                        thresholds.forEach(th => {
                            if (th >= t && !task.remindedLevels[idxStr].includes(th)) {
                                task.remindedLevels[idxStr].push(th);
                            }
                        });
                        updateTaskInSheet(task);
                        break; 
                    }
                }
            }

            // --- 2. OVERDUE (Lewat Deadline) ---
            else if (minutesLeft < 0 && !task.remindedLevels[idxStr].includes("OVERDUE")) {
                const resetBtn = new ButtonBuilder()
                    .setCustomId(`reset_${taskId}_${idxStr}`) 
                    .setLabel(`📢 Reset Slot: ${task.labels[idxStr]}`)
                    .setStyle(ButtonStyle.Danger);
                
                const row = new ActionRowBuilder().addComponents(resetBtn);
                
                sendLog(
                    "🚨 DEADLINE TERLEWAT<@&1228143820445847611>",
                    `**Tugas:** ${task.title}\n**Bagian:** ${task.labels[idxStr]}\n**User:** <@${userId}>\n\nKlik tombol di bawah untuk menendang user dan membuka slot kembali.`, 
                    "Red", 
                    [row]
                );

                task.remindedLevels[idxStr].push("OVERDUE");
                updateTaskInSheet(task);
            }
        }
    }
}

function createTaskEmbed(originalDesc, taskData) {
  const totalSlots = taskData.labels.length;
  const takenSlots = Object.keys(taskData.takenBy).length;
  const completedSlots = taskData.completed.length;
  const remaining = totalSlots - completedSlots;

  let color = "Green";
  let statusText = `🟢 Open (${remaining}/${totalSlots})`;
  if (remaining === 0) { color = "Blue"; statusText = "✅ All Completed"; } 
  else if (takenSlots > 0) { color = "Yellow"; statusText = `🟡 In Progress`; }

  let progressList = [];
  taskData.labels.forEach((label, index) => {
    const idxStr = index.toString();
    let line = `**${label}**: `;
    
    if (taskData.completed.includes(idxStr)) {
      const finisher = taskData.finishedBy[idxStr] ? `<@${taskData.finishedBy[idxStr]}>` : "Unknown";
      line += `${finisher} ✅`; 
    } else if (taskData.takenBy[idxStr]) {
      const ddl = taskData.deadlines[idxStr];
      const timestamp = ddl ? `<t:${Math.floor(ddl/1000)}:R>` : "No Timer";
      line += `<@${taskData.takenBy[idxStr]}> ⏳ (${timestamp})`; 
    } else { 
      line += `⚪ _(Kosong)_`; 
    }
    progressList.push(line);
  });

  const finalDesc = `${originalDesc}\n\n**⏱️ Waktu Pengerjaan:** ${taskData.duration} Menit (Dimulai saat diambil)\n**💰 Reward:** ${taskData.pointValue} Poin\n**📋 Progress List:**\n${progressList.join("\n")}`;

  return new EmbedBuilder().setTitle(taskData.title).setDescription(finalDesc)
    .addFields({ name: "Status", value: statusText, inline: true }) 
    .setColor(color);
}

function rebuildButtons(originalComponents, actionIndex, actionType) {
  const newRows = [];
  if (!originalComponents) return []; 
  for (const row of originalComponents) {
    const newRow = new ActionRowBuilder();
    for (const component of row.components) {
      const btnIndex = component.customId.split("_")[1];
      let newBtn = ButtonBuilder.from(component);
      if (btnIndex === actionIndex) {
        if (actionType === "TAKEN") { newBtn.setCustomId(`done_${btnIndex}`).setLabel("Selesai").setStyle(ButtonStyle.Primary); }
        else if (actionType === "DONE") { continue; }
      } 
      newRow.addComponents(newBtn);
    }
    if (newRow.components.length > 0) newRows.push(newRow);
  }
  return newRows;
}

function generateInitialButtons(labels, takenBy) {
  const rows = [];
  let currentRow = new ActionRowBuilder();
  labels.forEach((label, idx) => {
    let style = ButtonStyle.Secondary;
    let labelText = label;
    let customId = `take_${idx}`;
    if (takenBy[idx]) {
      style = ButtonStyle.Primary;
      labelText = "Selesai";
      customId = `done_${idx}`;
    }
    currentRow.addComponents(new ButtonBuilder().setCustomId(customId).setLabel(labelText).setStyle(style));
    if (currentRow.components.length === 5) { rows.push(currentRow); currentRow = new ActionRowBuilder(); }
  });
  if (currentRow.components.length > 0) rows.push(currentRow);
  return rows;
}

/* ================= HANDLERS ================= */

async function handleCommand(interaction) {
  if (interaction.isAutocomplete()) {
    const focusedOption = interaction.options.getFocused(true);
    const focusedValue = focusedOption.value.toLowerCase();
    
    if (focusedOption.name === 'title') {
        let choices = [];
        availableTitles.forEach((name, id) => choices.push({ name: `${name} (ID: ${id})`, value: id }));
        const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedValue)).slice(0, 25);
        await interaction.respond(filtered).catch(() => {});
    } 
    else if (focusedOption.name === 'role') {
        let choices = [];
        availableRoles.forEach((name, id) => choices.push({ name: name, value: id }));
        const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedValue)).slice(0, 25);
        await interaction.respond(filtered).catch(() => {});
    }
    return;
  }

  const { commandName, user } = interaction;

  if (commandName === "setlog") {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Lu bukan Admin!", ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    activeLogChannelId = channel.id;
    await saveSettingsToSheet('LOG_CHANNEL_ID', channel.id);
    await interaction.reply(`✅ **Berhasil!**\nLog sekarang akan dikirim ke channel ${channel}.`);
    sendLog("⚙️ Log Channel Diupdate", `Oleh Admin: <@${user.id}>\nChannel Baru: ${channel}`, "Blue");
  }

  else if (commandName === "setreminder") {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Lu bukan Admin!", ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    activeReminderChannelId = channel.id;
    await saveSettingsToSheet('REMINDER_CHANNEL_ID', channel.id);
    await interaction.reply(`✅ **Berhasil!**\nReminder akan dikirim ke channel ${channel}.`);
    sendLog("⚙️ Reminder Channel Diupdate", `Oleh Admin: <@${user.id}>\nChannel Baru: ${channel}`, "Blue");
  }

  else if (commandName === "stop") {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Lu bukan Admin!", ephemeral: true });
    if (tasks.size === 0) return interaction.reply({ content: "📂 Tidak ada task aktif.", ephemeral: true });

    const selectMenu = new StringSelectMenuBuilder().setCustomId('stop_select').setPlaceholder('Pilih tugas untuk dihentikan...');
    let count = 0;
    tasks.forEach((task, id) => {
        if (count < 25) {
            selectMenu.addOptions(new StringSelectMenuOptionBuilder().setLabel(task.title.substring(0, 100)).setValue(id).setDescription(`ID: ${id}`).setEmoji("🛑"));
            count++;
        }
    });
    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.reply({ content: "⚠️ **Pilih tugas yang ingin dihentikan paksa:**", components: [row], ephemeral: true });
  }

  else if (commandName === "refresh") {
    await interaction.deferReply({ ephemeral: true });
    try { 
        await initSpreadsheet(); 
        await interaction.editReply(`✅ **SINKRONISASI SUKSES!**\nJudul: ${availableTitles.size} | Role: ${availableRoles.size} | User Points: ${points.size}`); 
    } 
    catch (e) { await interaction.editReply("❌ Gagal refresh."); console.error(e); }
  }

  else if (commandName === "reset") {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Lu bukan Admin!", ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
        const sheetPoints = doc.sheetsByTitle['Points'];
        await sheetPoints.clear(); 
        await sheetPoints.setHeaderRow(['UserID', 'Points', 'Username']);
        points.clear();
        await interaction.editReply(`⚠️ **LEADERBOARD DI-RESET!**\nSemua poin dihapus.`);
        sendLog("⚠️ LEADERBOARD RESET", `Dilakukan oleh: <@${user.id}>`, "Red");
    } catch (e) { await interaction.editReply("❌ Gagal melakukan reset."); console.error(e); }
  }

  else if (commandName === "cancel") {
    const userTasks = [];
    for (const [id, task] of tasks) {
        for (const [btnIdx, userId] of Object.entries(task.takenBy)) {
            if (userId === user.id) {
                userTasks.push({ id: id, btnIdx: btnIdx, title: task.title, label: task.labels[btnIdx] });
            }
        }
    }
    if (userTasks.length === 0) return interaction.reply({ content: "🚫 Kamu tidak sedang mengambil tugas apapun.", ephemeral: true });
    const selectMenu = new StringSelectMenuBuilder().setCustomId('cancel_select').setPlaceholder('Pilih tugas yang mau dibatalkan...');
    userTasks.forEach(t => {
        selectMenu.addOptions(new StringSelectMenuOptionBuilder().setLabel(`${t.label} - ${t.title.substring(0, 50)}`).setValue(`${t.id}_${t.btnIdx}`).setDescription("Klik untuk membatalkan").setEmoji("↩️"));
    });
    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.reply({ content: "⚠️ **Pilih tugas yang ingin kamu batalkan:**", components: [row], ephemeral: true });
  }

  else if (commandName === "task") {
    const selectedID = interaction.options.getString("title");
    const selectedRoleID = interaction.options.getString("role");
    const customIdValues = `createTaskModal###${selectedID}###${selectedRoleID}`;
    const modal = new ModalBuilder().setCustomId(customIdValues).setTitle(`Buat Tugas`);
    modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('descInput').setLabel("Deskripsi").setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('deadlineInput').setLabel("Waktu (Menit)").setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pointInput').setLabel("Poin").setStyle(TextInputStyle.Short).setValue("1")),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('buttonsInput').setLabel("List Tombol (Koma)").setStyle(TextInputStyle.Short))
    );
    await interaction.showModal(modal);
  }

  else if (commandName === "list") {
    if (tasks.size === 0) return interaction.reply({ content: "📂 Tidak ada task aktif.", ephemeral: true });
    const fields = [];
    tasks.forEach((task, id) => {
        const shortId = id.slice(-4); 
        fields.push({ name: `🆔 ...${shortId} | ${task.title}`, value: `Reward: ${task.pointValue} Pts | [Link Pesan](https://discord.com/channels/${CONFIG.GUILD_ID}/${task.channelId}/${id})` });
    });
    const embed = new EmbedBuilder().setTitle("📂 TASK AKTIF").setColor("Blue").addFields(fields.slice(0, 25));
    interaction.reply({ embeds: [embed] });
  }
  
  else if (commandName === "point") {
    const score = points.get(user.id) || 0;
    interaction.reply({ content: `⭐ Point lu: **${score}**`, ephemeral: true });
  }

  // ============================================
  // 🔥 FITUR BARU: LEADERBOARD CANVAS 🔥
  // ============================================
  else if (commandName === "leaderboard") {
    if (!points.size) return interaction.reply({ content: "📂 Belum ada data poin yang tercatat.", ephemeral: true });
    
    // Defer karena render gambar agak lama
    await interaction.deferReply(); 

    try {
        const canvas = Canvas.createCanvas(700, 800);
        const ctx = canvas.getContext('2d');

        // Load Background (Fallback jika file tidak ada)
        try {
            const background = await Canvas.loadImage('./leaderboard.jpg');
            ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
        } catch (err) {
            ctx.fillStyle = '#23272A';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Header
        ctx.font = 'bold 50px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText('🏆 TOP 10 LEADERBOARD', canvas.width / 2, 80);

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(100, 100);
        ctx.lineTo(600, 100);
        ctx.stroke();

        // Data Processing
        const sorted = [...points.entries()]
            .sort((a, b) => b[1] - a[1]) 
            .slice(0, 10); 

        let y = 160; 
        
        for (let i = 0; i < sorted.length; i++) {
            const [userId, score] = sorted[i];
            
            // Fetch User Data
            let userObj;
            try { userObj = await client.users.fetch(userId); } 
            catch (e) { userObj = { username: "Unknown User", displayAvatarURL: () => null }; }
            
            const username = userObj.username;
            const avatarURL = userObj.displayAvatarURL({ extension: 'png', size: 128 });

            // Kotak Background User
            ctx.globalAlpha = 0.6; 
            ctx.fillStyle = '#000000'; 
            
            if (i === 0) ctx.fillStyle = '#D4AF37'; // Emas
            if (i === 1) ctx.fillStyle = '#C0C0C0'; // Perak
            if (i === 2) ctx.fillStyle = '#CD7F32'; // Perunggu
            
            ctx.fillRect(50, y - 40, 600, 60);
            ctx.globalAlpha = 1.0; 

            // Ranking
            ctx.font = 'bold 30px sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.fillText(`#${i + 1}`, 70, y);

            // Avatar
            try {
                const avatar = await Canvas.loadImage(avatarURL);
                ctx.save(); 
                ctx.beginPath();
                ctx.arc(160, y - 10, 25, 0, Math.PI * 2, true); 
                ctx.closePath();
                ctx.clip(); 
                ctx.drawImage(avatar, 135, y - 35, 50, 50); 
                ctx.restore(); 
            } catch (e) { /* Ignore avatar fail */ }

            // Username
            ctx.font = '28px sans-serif';
            ctx.fillStyle = '#ffffff';
            let displayName = username.length > 15 ? username.substring(0, 15) + "..." : username;
            ctx.fillText(displayName, 200, y);

            // Points
            ctx.font = 'bold 30px sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'right';
            ctx.fillText(`${score} PTS`, 630, y);

            y += 70; 
        }

        const attachment = new AttachmentBuilder(canvas.toBuffer(), { name: 'leaderboard.png' });
        await interaction.editReply({ files: [attachment] });

    } catch (error) {
        console.error("Gagal render leaderboard:", error);
        await interaction.editReply("❌ Gagal membuat gambar leaderboard.");
    }
  }
}

async function handleSelectMenu(interaction) {
    if (interaction.customId === 'stop_select') {
        await interaction.deferUpdate();
        const taskId = interaction.values[0];
        const task = tasks.get(taskId);
        if (!task) return interaction.followUp({ content: "❌ Tugas tidak ditemukan / sudah dihapus.", ephemeral: true });

        const channel = client.channels.cache.get(task.channelId);
        if (channel) {
            const msg = await channel.messages.fetch(taskId);
            if (msg) {
                const stoppedEmbed = EmbedBuilder.from(msg.embeds[0]).setColor("Red").setTitle(`⛔ DIHENTIKAN: ${task.title}`).setDescription(`❌ **Lelang ini dihentikan paksa oleh Admin.**\n\n${task.originalDesc}`);
                await msg.edit({ embeds: [stoppedEmbed], components: [] });
            }
        }
        tasks.delete(taskId);
        deleteTaskFromSheet(taskId);
        sendLog("⛔ Tugas Dihentikan", `Tugas **${task.title}** dihentikan paksa oleh <@${interaction.user.id}>`, "Red");
        await interaction.editReply({ content: `✅ Berhasil menghentikan tugas: **${task.title}**`, components: [] });
        return;
    }

    if (interaction.customId !== 'cancel_select') return;
    await interaction.deferUpdate(); 
    const value = interaction.values[0]; 
    const [msgId, btnIdx] = value.split('_');
    const task = tasks.get(msgId);
    if (!task) return interaction.followUp({ content: "❌ Tugas ini sudah tidak aktif / dihapus.", ephemeral: true });
    
    // 🔥 CLEAR DEADLINE SAAT CANCEL 🔥
    delete task.takenBy[btnIdx];
    delete task.deadlines[btnIdx]; 
    delete task.remindedLevels[btnIdx];

    updateTaskInSheet(task);
    sendLog("↩️ Tugas Dibatalkan", `User: <@${interaction.user.id}>\nTugas: ${task.title}\nBagian: ${task.labels[btnIdx]}`, "Red");

    try {
        const channel = client.channels.cache.get(task.channelId);
        if (channel) {
            const msg = await channel.messages.fetch(msgId);
            if (msg) {
                const newRows = generateInitialButtons(task.labels, task.takenBy);
                const newEmbed = createTaskEmbed(task.originalDesc, task);
                await msg.edit({ embeds: [newEmbed], components: newRows });
            }
        }
    } catch (e) { console.error("Gagal update pesan saat cancel:", e); }
    await interaction.editReply({ content: `✅ Sukses membatalkan tugas **${task.title}** (${task.labels[btnIdx]}).`, components: [] });
}

async function handleModal(interaction) {
    if (!interaction.customId.startsWith("createTaskModal")) return;
    await interaction.deferReply({ ephemeral: true });
    const parts = interaction.customId.split("###");
    const realTitle = availableTitles.get(parts[1]) || "Tugas";
    const roleId = parts[2];
    
    const rawDesc = interaction.fields.getTextInputValue('descInput');
    const deadlineVal = parseInt(interaction.fields.getTextInputValue('deadlineInput'));
    const pointVal = parseInt(interaction.fields.getTextInputValue('pointInput') || "1");
    const buttonsRaw = interaction.fields.getTextInputValue('buttonsInput');

    if (isNaN(deadlineVal)) return interaction.editReply("❌ Waktu harus angka!");
    // Deadline bukan timestamp lagi, tapi DURASI
    
    const buttonLabels = buttonsRaw ? buttonsRaw.split(",").map(b => b.trim()).filter(b => b).slice(0, 15) : ["Ambil Tugas"];
    
    const rows = generateInitialButtons(buttonLabels, {}); 
    const taskData = {
        originalDesc: rawDesc, title: realTitle, 
        labels: buttonLabels, takenBy: {}, finishedBy: {}, completed: [], 
        pointValue: pointVal, 
        duration: deadlineVal, // Save Durasi
        deadline: deadlineVal, // Save ke DB column
        channelId: interaction.channelId,
        deadlines: {}, // Init empty
        remindedLevels: {}, 
        adminNotified: false, roleId: roleId 
    };
    
    const embed = createTaskEmbed(rawDesc, taskData);
    const msgPayload = { embeds: [embed], components: rows };
    if (roleId) msgPayload.content = `<${roleId}>`; 

    const msg = await interaction.channel.send(msgPayload);
    const finalTaskData = { ...taskData, id: msg.id };
    tasks.set(msg.id, finalTaskData);
    saveTaskToSheet(finalTaskData);
    
    const roleName = availableRoles.get(roleId) || "Semua (No Role)";
    sendLog("📝 Tugas Baru Dibuat", `Judul: ${realTitle}\nDibuat oleh: <@${interaction.user.id}>\nRole: ${roleName}`, "Blue");
    await interaction.editReply(`✅ Sukses! Task **${realTitle}** berhasil dibuat.`);
}

async function handleButton(interaction) {
  const { customId, message, user, member } = interaction;
  
  if (customId.startsWith("delete_")) {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Hanya admin!", ephemeral: true });
      await interaction.deferUpdate();
      const taskId = customId.split("_")[1];
      tasks.delete(taskId);
      deleteTaskFromSheet(taskId);
      await message.delete().catch(() => {});
      sendLog("🗑️ Tugas Dihapus", `Tugas dihapus manual oleh <@${user.id}>`, "Red");
      return;
  }

  // 🔥 FITUR RESET SPESIFIK (Lelang Ulang per Slot) 🔥
  if (customId.startsWith("reset_")) {
      await interaction.deferUpdate();
      const [_, taskId, idxStr] = customId.split("_");
      const task = tasks.get(taskId);
      if (!task) return interaction.followUp({ content: "❌ Tugas tidak ditemukan.", ephemeral: true });
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.followUp({ content: "❌ Hanya admin!", ephemeral: true });

      // Reset slot spesifik
      const kickedUser = task.takenBy[idxStr];
      delete task.takenBy[idxStr];
      delete task.deadlines[idxStr];
      delete task.remindedLevels[idxStr];
      updateTaskInSheet(task);

      await interaction.message.edit({ components: [] }); 
      await interaction.followUp({ content: `✅ Slot ${task.labels[idxStr]} berhasil di-reset.`, ephemeral: true });

      // Update Pesan Asli
      const channel = client.channels.cache.get(task.channelId);
      if (channel) {
          const originalMsg = await channel.messages.fetch(taskId);
          if (originalMsg) {
              const newRows = generateInitialButtons(task.labels, task.takenBy); // Refresh button
              const newEmbed = createTaskEmbed(task.originalDesc, task);
              await originalMsg.edit({ embeds: [newEmbed], components: newRows });
          }
      }
      return;
  }

  await interaction.deferUpdate();
  let task = tasks.get(message.id);
  if (!task) return interaction.followUp({ content: "⚠️ Data hilang.", ephemeral: true });

  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  const requiredRoleId = task.roleId; 
  if (requiredRoleId && !isAdmin && !member.roles.cache.has(requiredRoleId)) {
      return interaction.followUp({ content: `🔒 **Akses Ditolak!** Khusus role <${requiredRoleId}>.`, ephemeral: true });
  }

  const [action, indexStr] = customId.split("_");
  const index = indexStr; 

  if (action === "take") {
    if (task.takenBy[index]) return interaction.followUp({ content: "❌ Sudah diambil!", ephemeral: true });
    for (const [activeTaskId, activeTaskData] of tasks) {
        if (Object.values(activeTaskData.takenBy).includes(user.id)) {
            const linkTask = `https://discord.com/channels/${CONFIG.GUILD_ID}/${activeTaskData.channelId}/${activeTaskId}`;
            return interaction.followUp({ content: `❌ **Gak boleh maruk!** Selesaikan tugasmu dulu.\n[Lihat Tugas](${linkTask})`, ephemeral: true });
        }
    }
    
    // 🔥 SET DEADLINE SAAT KLIK 🔥
    task.takenBy[index] = user.id;
    task.deadlines[index] = Date.now() + (task.duration * 60000); 
    updateTaskInSheet(task); 
    
    sendLog("⏳ Tugas Diambil", `User: <@${user.id}>\nTugas: ${task.title}\nBagian: ${task.labels[index]}`, "Yellow");

    let currentRows = message.components;
    if (!currentRows || currentRows.length === 0) currentRows = generateInitialButtons(task.labels, task.takenBy); 
    else currentRows = rebuildButtons(currentRows, index, "TAKEN");
    const newEmbed = createTaskEmbed(task.originalDesc, task); 
    await interaction.editReply({ embeds: [newEmbed], components: currentRows });
  }

  else if (action === "done") {
    if (task.takenBy[index] !== user.id && !isAdmin) return interaction.followUp({ content: "❌ Bukan tugas lu!", ephemeral: true });
    
    const reward = task.pointValue || 1;
    const workerId = task.takenBy[index]; 
    const currentScore = (points.get(workerId) || 0) + reward;
    points.set(workerId, currentScore);
    const workerUsername = (workerId === user.id) ? user.username : "User (Force Finish)";
    savePointToSheet(workerId, workerUsername, currentScore);

    let logDesc = `User: <@${workerId}>\nTugas: ${task.title}\nBagian: ${task.labels[index]}\nReward: +${reward} Point`;
    if (user.id !== workerId) logDesc += `\n⚠️ *Force Finish oleh Admin: <@${user.id}>*`;
    sendLog("✅ Tugas Selesai", logDesc, "Green");

    task.completed.push(index);
    task.finishedBy[index] = workerId; 
    delete task.takenBy[index]; 
    delete task.deadlines[index]; // Clear timer
    delete task.remindedLevels[index]; // Clear reminder state

    updateTaskInSheet(task); 

    let currentRows = message.components;
    if (!currentRows || currentRows.length === 0) currentRows = rebuildButtons(generateInitialButtons(task.labels, { [index]: workerId }), index, "DONE");
    else currentRows = rebuildButtons(currentRows, index, "DONE");

    if (currentRows.length === 0) {
      const deleteBtn = new ButtonBuilder().setCustomId(`delete_${task.id}`).setLabel("🗑️ Hapus Lelang").setStyle(ButtonStyle.Danger);
      const row = new ActionRowBuilder().addComponents(deleteBtn);
      const finishedEmbed = createTaskEmbed(task.originalDesc, task);
      await interaction.editReply({ embeds: [finishedEmbed], components: [row] });
    } else {
      const newEmbed = createTaskEmbed(task.originalDesc, task);
      await interaction.editReply({ embeds: [newEmbed], components: currentRows });
    }
  }
}

/* ================= EVENTS ================= */
client.once(Events.ClientReady, async () => {
  console.log(`🔥 Logged in as ${client.user.tag}`);
  await initSpreadsheet(); 
  setInterval(() => { checkReminders(); }, 60000); 
  console.log("⏰ Reminder System Started (Tick: 1m)");
});

client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isChatInputCommand()) await handleCommand(i);
    else if (i.isAutocomplete()) await handleCommand(i);
    else if (i.isModalSubmit()) await handleModal(i);
    else if (i.isStringSelectMenu()) await handleSelectMenu(i);
    else if (i.isButton()) await handleButton(i);
  } catch (err) { console.error(err); }
});

(async () => {
  const commands = [
    new SlashCommandBuilder().setName("point").setDescription("Cek poin"),
    new SlashCommandBuilder().setName("list").setDescription("Lihat semua task aktif"),
    new SlashCommandBuilder().setName("refresh").setDescription("Sinkronisasi data Bot dengan Excel").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("reset").setDescription("⚠️ HAPUS SEMUA DATA POIN (Start New Season)").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Cek leaderboard").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("cancel").setDescription("Batalkan tugas yang sedang diambil"),
    new SlashCommandBuilder().setName("stop").setDescription("Hentikan paksa tugas aktif").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("setlog").setDescription("Atur channel untuk Log Bot")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Pilih channel...').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName("setreminder").setDescription("Atur channel untuk Reminder")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Pilih channel...').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName("task").setDescription("Buat task (Formulir)")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o => o.setName("title").setDescription("Pilih Judul...").setAutocomplete(true).setRequired(true))
      .addStringOption(o => o.setName("role").setDescription("Pilih Role untuk ditag...").setAutocomplete(true).setRequired(true))
  ].map(c => c.toJSON());
  try {
    await new REST({ version: "10" }).setToken(CONFIG.TOKEN).put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID), { body: commands });
    console.log("✅ Ready!");
    client.login(CONFIG.TOKEN);
  } catch (e) { console.error(e); }
})();