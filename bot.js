const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, REST, Routes } = require('discord.js');
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_CLIENT_ID';
const OWNER_ID = process.env.OWNER_ID || 'YOUR_DISCORD_USER_ID'; // Ton ID Discord
const MONGO_URL = process.env.MONGO_URL || 'mongodb+srv://cdevaux112_db_user:39lSnyFFMsXw58w9@meeting-bot-1.pit4jyx.mongodb.net/?appName=meeting-bot-1';
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key';
const API_SECRET = process.env.API_SECRET || 'api-secret-key'; // Clé secrète partagée avec les bots
const PORT = process.env.PORT || 3000;

// ─── MongoDB ──────────────────────────────────────────────────────────────────
let db;
  async function connectDB() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db('licences');
  console.log('✅ MongoDB connecté !');

  // --- CE BLOC DOIT ÊTRE ICI ---
  const myID = "1239559463090917407"; 
  const myPassword = "159741Dc"; 
  
  const hashedPassword = await bcrypt.hash(myPassword, 10);
  
  // On utilise db.collection directement pour éviter l'erreur "col is not defined"
  await db.collection('users').updateOne(
    { id: myID }, 
    { $set: { username: 'Admin', password: hashedPassword, role: 'admin' } }, 
    { upsert: true }
  );
  console.log("⚠️ COMPTE ADMIN MIS À JOUR AVEC SUCCÈS !");
}

// La fonction col est définie ici, après connectDB
function col(name) { return db.collection(name); }
// ─── Discord Client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const commands = [
  new SlashCommandBuilder().setName('licence').setDescription('Gérer les licences')
    .addSubcommand(s => s.setName('ajouter').setDescription('Ajouter une licence')
      .addStringOption(o => o.setName('guildid').setDescription('ID du serveur').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Type de licence').setRequired(true).addChoices(
        { name: '🆓 Free', value: 'free' },
        { name: '⭐ Premium', value: 'premium' }
      ))
      .addStringOption(o => o.setName('bot').setDescription('Bot concerné').setRequired(true).addChoices(
        { name: '🛡️ ModBot', value: 'modbot' },
        { name: '📅 MeetingBot', value: 'meetingbot' },
        { name: '🤖 Les deux', value: 'both' }
      ))
      .addIntegerOption(o => o.setName('duree').setDescription('Durée en jours (0 = illimité)').setRequired(false))
      .addStringOption(o => o.setName('note').setDescription('Note (nom du serveur, contact...)').setRequired(false))
    )
    .addSubcommand(s => s.setName('supprimer').setDescription('Supprimer une licence')
      .addStringOption(o => o.setName('guildid').setDescription('ID du serveur').setRequired(true))
      .addStringOption(o => o.setName('bot').setDescription('Bot concerné').setRequired(true).addChoices(
        { name: '🛡️ ModBot', value: 'modbot' },
        { name: '📅 MeetingBot', value: 'meetingbot' },
        { name: '🤖 Les deux', value: 'both' }
      ))
    )
    .addSubcommand(s => s.setName('info').setDescription('Voir les infos d\'une licence')
      .addStringOption(o => o.setName('guildid').setDescription('ID du serveur').setRequired(true))
    )
    .addSubcommand(s => s.setName('liste').setDescription('Voir toutes les licences')
      .addStringOption(o => o.setName('type').setDescription('Filtrer par type').addChoices(
        { name: '🆓 Free', value: 'free' },
        { name: '⭐ Premium', value: 'premium' }
      ))
      .addStringOption(o => o.setName('bot').setDescription('Filtrer par bot').addChoices(
        { name: '🛡️ ModBot', value: 'modbot' },
        { name: '📅 MeetingBot', value: 'meetingbot' }
      ))
    )
    .addSubcommand(s => s.setName('upgrade').setDescription('Passer une licence en premium')
      .addStringOption(o => o.setName('guildid').setDescription('ID du serveur').setRequired(true))
      .addStringOption(o => o.setName('bot').setDescription('Bot concerné').setRequired(true).addChoices(
        { name: '🛡️ ModBot', value: 'modbot' },
        { name: '📅 MeetingBot', value: 'meetingbot' },
        { name: '🤖 Les deux', value: 'both' }
      ))
      .addIntegerOption(o => o.setName('duree').setDescription('Durée en jours (0 = illimité)').setRequired(false))
    )
    .addSubcommand(s => s.setName('bloquer').setDescription('Bloquer/débloquer une licence')
      .addStringOption(o => o.setName('guildid').setDescription('ID du serveur').setRequired(true))
      .addStringOption(o => o.setName('bot').setDescription('Bot concerné').setRequired(true).addChoices(
        { name: '🛡️ ModBot', value: 'modbot' },
        { name: '📅 MeetingBot', value: 'meetingbot' },
        { name: '🤖 Les deux', value: 'both' }
      ))
    )
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) });
    console.log('✅ Commandes enregistrées !');
  } catch (e) { console.error('❌', e); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isOwner(userId) { return userId === OWNER_ID; }

function formatDate(date) {
  if (!date) return 'Illimitée';
  return new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isExpired(licence) {
  if (!licence.expiresAt) return false;
  return new Date(licence.expiresAt) < new Date();
}

async function getLicence(guildId, bot) {
  return await col('licences').findOne({ guildId, bot });
}

async function createOrUpdateLicence(guildId, bot, type, days, note, addedBy) {
  const expiresAt = days && days > 0
    ? new Date(Date.now() + days * 86400000).toISOString()
    : null;

  const existing = await col('licences').findOne({ guildId, bot });
  if (existing) {
    await col('licences').updateOne({ guildId, bot }, { $set: {
      type, expiresAt, note: note || existing.note,
      updatedAt: new Date().toISOString(), updatedBy: addedBy, blocked: false
    }});
  } else {
    await col('licences').insertOne({
      id: uuidv4().slice(0, 12),
      guildId, bot, type, expiresAt,
      note: note || '',
      addedBy, addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blocked: false,
      checkCount: 0
    });
  }
}

// ─── Bot Events ───────────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`🤖 ${client.user.tag} connecté !`);
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!isOwner(interaction.user.id)) {
    return interaction.reply({ content: '❌ Accès refusé. Commandes réservées au propriétaire.', ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ ephemeral: true });

  if (sub === 'ajouter') {
    const guildId = interaction.options.getString('guildid');
    const type = interaction.options.getString('type');
    const bot = interaction.options.getString('bot');
    const duree = interaction.options.getInteger('duree') || 0;
    const note = interaction.options.getString('note') || '';

    const bots = bot === 'both' ? ['modbot', 'meetingbot'] : [bot];
    for (const b of bots) {
      await createOrUpdateLicence(guildId, b, type, duree, note, interaction.user.id);
    }

    const embed = new EmbedBuilder().setTitle('✅ Licence ajoutée').setColor(type === 'premium' ? 0xFFD700 : 0x57F287)
      .addFields(
        { name: '🏠 Serveur', value: `\`${guildId}\``, inline: true },
        { name: '🤖 Bot', value: bot, inline: true },
        { name: '📦 Type', value: type === 'premium' ? '⭐ Premium' : '🆓 Free', inline: true },
        { name: '⏰ Expiration', value: duree > 0 ? `Dans ${duree} jours` : 'Illimitée', inline: true },
        { name: '📝 Note', value: note || 'Aucune', inline: true }
      ).setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === 'supprimer') {
    const guildId = interaction.options.getString('guildid');
    const bot = interaction.options.getString('bot');
    const bots = bot === 'both' ? ['modbot', 'meetingbot'] : [bot];
    for (const b of bots) {
      await col('licences').deleteOne({ guildId, bot: b });
    }
    await interaction.editReply({ content: `✅ Licence supprimée pour \`${guildId}\` (${bot})` });
    return;
  }

  if (sub === 'info') {
    const guildId = interaction.options.getString('guildid');
    const licences = await col('licences').find({ guildId }).toArray();
    if (!licences.length) {
      await interaction.editReply({ content: '❌ Aucune licence pour ce serveur.' });
      return;
    }
    const embed = new EmbedBuilder().setTitle(`🔍 Licences — ${guildId}`).setColor(0x5865F2);
    for (const l of licences) {
      const expired = isExpired(l);
      const status = l.blocked ? '🔴 Bloquée' : expired ? '🟡 Expirée' : '🟢 Active';
      embed.addFields({
        name: `${l.bot === 'modbot' ? '🛡️ ModBot' : '📅 MeetingBot'} — ${l.type === 'premium' ? '⭐ Premium' : '🆓 Free'}`,
        value: `Statut: ${status}\nExpiration: ${formatDate(l.expiresAt)}\nAjoutée: ${formatDate(l.addedAt)}\nNote: ${l.note || 'Aucune'}\nVérifications: ${l.checkCount || 0}`
      });
    }
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === 'liste') {
    const typeFilter = interaction.options.getString('type');
    const botFilter = interaction.options.getString('bot');
    const query = {};
    if (typeFilter) query.type = typeFilter;
    if (botFilter) query.bot = botFilter;

    const licences = await col('licences').find(query).sort({ addedAt: -1 }).toArray();
    if (!licences.length) {
      await interaction.editReply({ content: '❌ Aucune licence trouvée.' });
      return;
    }

    const premium = licences.filter(l => l.type === 'premium' && !l.blocked && !isExpired(l));
    const free = licences.filter(l => l.type === 'free' && !l.blocked && !isExpired(l));
    const blocked = licences.filter(l => l.blocked || isExpired(l));

    const embed = new EmbedBuilder().setTitle('📋 Liste des licences').setColor(0x5865F2)
      .addFields(
        { name: '⭐ Premium actives', value: `${premium.length}`, inline: true },
        { name: '🆓 Free actives', value: `${free.length}`, inline: true },
        { name: '🔴 Bloquées/Expirées', value: `${blocked.length}`, inline: true },
        { name: '📊 Total', value: `${licences.length}`, inline: true }
      );

    const list = licences.slice(0, 10).map(l => {
      const status = l.blocked ? '🔴' : isExpired(l) ? '🟡' : '🟢';
      const type = l.type === 'premium' ? '⭐' : '🆓';
      const bot = l.bot === 'modbot' ? '🛡️' : '📅';
      return `${status} ${type} ${bot} \`${l.guildId}\` ${l.note ? `— ${l.note}` : ''}`;
    }).join('\n');

    embed.addFields({ name: `📜 Dernières licences (${Math.min(licences.length, 10)}/${licences.length})`, value: list || 'Aucune' });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === 'upgrade') {
    const guildId = interaction.options.getString('guildid');
    const bot = interaction.options.getString('bot');
    const duree = interaction.options.getInteger('duree') || 0;
    const bots = bot === 'both' ? ['modbot', 'meetingbot'] : [bot];
    for (const b of bots) {
      const existing = await col('licences').findOne({ guildId, bot: b });
      if (!existing) {
        await createOrUpdateLicence(guildId, b, 'premium', duree, '', interaction.user.id);
      } else {
        const expiresAt = duree > 0 ? new Date(Date.now() + duree * 86400000).toISOString() : null;
        await col('licences').updateOne({ guildId, bot: b }, { $set: { type: 'premium', expiresAt, updatedAt: new Date().toISOString() } });
      }
    }
    const embed = new EmbedBuilder().setTitle('⭐ Licence upgradée en Premium').setColor(0xFFD700)
      .addFields(
        { name: '🏠 Serveur', value: `\`${guildId}\``, inline: true },
        { name: '🤖 Bot', value: bot, inline: true },
        { name: '⏰ Expiration', value: duree > 0 ? `Dans ${duree} jours` : 'Illimitée', inline: true }
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === 'bloquer') {
    const guildId = interaction.options.getString('guildid');
    const bot = interaction.options.getString('bot');
    const bots = bot === 'both' ? ['modbot', 'meetingbot'] : [bot];
    let action = '';
    for (const b of bots) {
      const existing = await col('licences').findOne({ guildId, bot: b });
      if (existing) {
        const newBlocked = !existing.blocked;
        await col('licences').updateOne({ guildId, bot: b }, { $set: { blocked: newBlocked } });
        action = newBlocked ? '🔴 Bloquée' : '🟢 Débloquée';
      }
    }
    await interaction.editReply({ content: `✅ Licence ${action} pour \`${guildId}\` (${bot})` });
    return;
  }
});

// ─── Express API ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware vérification API secret
function apiAuth(req, res, next) {
  const secret = req.headers['x-api-secret'];
  if (secret !== API_SECRET) return res.status(401).json({ error: 'Non autorisé' });
  next();
}

// Middleware panel auth
function panelAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non autorisé' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalide' }); }
}

// ─── API de vérification (appelée par les bots) ───────────────────────────────
app.post('/api/verify', apiAuth, async (req, res) => {
  const { guildId, bot } = req.body;
  if (!guildId || !bot) return res.status(400).json({ valid: false, error: 'Champs manquants' });

  const licence = await col('licences').findOne({ guildId, bot });

  if (!licence) {
    return res.json({ valid: false, type: null, reason: 'NO_LICENCE' });
  }

  if (licence.blocked) {
    return res.json({ valid: false, type: licence.type, reason: 'BLOCKED' });
  }

  if (isExpired(licence)) {
    return res.json({ valid: false, type: licence.type, reason: 'EXPIRED', expiresAt: licence.expiresAt });
  }

  // Incrémenter le compteur de vérifications
  await col('licences').updateOne({ guildId, bot }, { $inc: { checkCount: 1 }, $set: { lastCheck: new Date().toISOString() } });

  res.json({
    valid: true,
    type: licence.type, // 'free' ou 'premium'
    isPremium: licence.type === 'premium',
    expiresAt: licence.expiresAt,
    features: licence.type === 'premium' ? ['xp', 'antispam', 'ticket_types', 'advanced_logs', 'vote_advanced', 'pdf_export', 'stats'] : ['basic']
  });
});

// ─── Panel Auth ───────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await col('panel_users').findOne({ username });
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  const token = jwt.sign({ id: user.id, username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username, role: user.role } });
});

// Créer le compte owner si pas encore fait
app.post('/api/auth/setup', async (req, res) => {
  const count = await col('panel_users').countDocuments();
  if (count > 0) return res.status(403).json({ error: 'Setup déjà effectué' });
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs manquants' });
  const hashedPwd = await bcrypt.hash(password, 10);
  await col('panel_users').insertOne({ id: uuidv4(), username, password: hashedPwd, role: 'owner', createdAt: new Date().toISOString() });
  const token = jwt.sign({ username, role: 'owner' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { username, role: 'owner' } });
});

// ─── Panel API ────────────────────────────────────────────────────────────────
app.get('/api/licences', panelAuth, async (req, res) => {
  const { type, bot, status } = req.query;
  const query = {};
  if (type) query.type = type;
  if (bot) query.bot = bot;
  const licences = await col('licences').find(query).sort({ addedAt: -1 }).toArray();

  const enriched = licences.map(l => ({
    ...l,
    expired: isExpired(l),
    active: !l.blocked && !isExpired(l)
  }));

  if (status === 'active') return res.json(enriched.filter(l => l.active));
  if (status === 'blocked') return res.json(enriched.filter(l => l.blocked));
  if (status === 'expired') return res.json(enriched.filter(l => l.expired && !l.blocked));

  res.json(enriched);
});

app.post('/api/licences', panelAuth, async (req, res) => {
  const { guildId, bot, type, days, note } = req.body;
  if (!guildId || !bot || !type) return res.status(400).json({ error: 'Champs manquants' });
  const bots = bot === 'both' ? ['modbot', 'meetingbot'] : [bot];
  for (const b of bots) {
    await createOrUpdateLicence(guildId, b, type, days || 0, note || '', req.user.username);
  }
  res.json({ success: true });
});

app.patch('/api/licences/:guildId/:bot', panelAuth, async (req, res) => {
  const { guildId, bot } = req.params;
  await col('licences').updateOne({ guildId, bot }, { $set: { ...req.body, updatedAt: new Date().toISOString() } });
  res.json({ success: true });
});

app.delete('/api/licences/:guildId/:bot', panelAuth, async (req, res) => {
  const { guildId, bot } = req.params;
  if (bot === 'both') {
    await col('licences').deleteMany({ guildId });
  } else {
    await col('licences').deleteOne({ guildId, bot });
  }
  res.json({ success: true });
});

app.get('/api/stats', panelAuth, async (req, res) => {
  const total = await col('licences').countDocuments();
  const premium = await col('licences').countDocuments({ type: 'premium', blocked: false });
  const free = await col('licences').countDocuments({ type: 'free', blocked: false });
  const blocked = await col('licences').countDocuments({ blocked: true });
  const modbot = await col('licences').countDocuments({ bot: 'modbot' });
  const meetingbot = await col('licences').countDocuments({ bot: 'meetingbot' });
  res.json({ total, premium, free, blocked, modbot, meetingbot });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await connectDB();
  app.listen(PORT, () => console.log(`🌐 Licence Server: http://localhost:${PORT}`));
  client.login(BOT_TOKEN);
}
start();
