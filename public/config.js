// ===== ตั้งค่ากลางของเกม (ฝั่ง client) =====
// เปลี่ยน API_BASE_URL เป็น URL จริงตอน deploy เช่น "https://your-vn-api.com"
const CONFIG = {
    API_BASE_URL: "",
};

let allAssets = []; // Centralized asset storage

async function loadAllAssets() {
  if (allAssets.length > 0) return; // Assets already loaded

  try {
    const res = await fetch(`${CONFIG.API_BASE_URL}/api/assets`);
    if (!res.ok) throw new Error('Failed to load all assets');
    const assets = await res.json();
    // ถ้า assets_preload จาก chapter มาถึงก่อน อย่าเขียนทับด้วยชุดเต็ม
    if (allAssets.length === 0) allAssets = assets;
  } catch (e) {
    console.error('Error loading all assets:', e);
  }
}

// ===== ตัวช่วยสร้าง URL ของ asset ต่างๆ จากชื่อ (name) หรือ ID =====
// แก้ path/extension ตรงนี้ที่เดียว ถ้าโครงสร้างโฟลเดอร์บน server เปลี่ยน
/**
 * Resolves a character asset to its final URL.
 * This function is designed to be robust and handle various ways a character might be defined in a dialogue line.
 *
 * @param {object|string} characterInfo - An object describing the character or a string identifier.
 *   - As an object, it can have: { file_url, asset_url, asset_id, asset, asset_name, ... }
 *   - As a string, it's treated as an asset name (e.g., "knl309").
 * @returns {string} The final asset URL, or an empty string if not found.
 */
function characterAssetUrl(characterInfo) {
    if (!characterInfo) return '';

    // Case 1: The info is a simple string (e.g., "knl309")
    if (typeof characterInfo === 'string') {
        const asset = allAssets.find(a => a.asset_type === 'character' && a.asset_name === characterInfo);
        if (asset) return asset.file_url;
    }

    // Case 2: The info is an object
    if (typeof characterInfo === 'object') {
        // Priority 1: Direct URL is provided.
        if (characterInfo.file_url) return characterInfo.file_url;
        if (characterInfo.asset_url) return characterInfo.asset_url;

        // Priority 2: Asset ID is provided.
        if (typeof characterInfo.asset_id === 'number') {
            const asset = allAssets.find(a => a.asset_id === characterInfo.asset_id && a.asset_type === 'character');
            if (asset) return asset.file_url;
        }

        // Priority 3: Name-based search (asset, asset_name).
        const identifier = characterInfo.asset || characterInfo.asset_name;
        if (identifier) {
            const asset = allAssets.find(a => a.asset_type === 'character' && a.asset_name === identifier);
            if (asset) return asset.file_url;
        }
    }
    
    // If no asset was found after all checks, log a warning.
    console.warn(`Character asset not found for:`, characterInfo);
    return ''; // Return empty string if not found
}

function findAssetUrl(type, identifier) {
    if (!identifier) return null;
    if (identifier === "none") return "none";

    let asset;
    if (typeof identifier === 'number') {
        asset = allAssets.find(a => a.asset_id === identifier && a.asset_type === type);
    } else {
        asset = allAssets.find(a => a.asset_type === type && a.asset_name === identifier);
    }

    if (asset && asset.file_url) {
        return asset.file_url;
    }

    console.warn(`${type.toUpperCase()} asset "${identifier}" not found in loaded assets.`);
    return ''; // Return empty string if not found
}

function backgroundAssetUrl(bgName) {
    return findAssetUrl('background', bgName);
}

function bgmAssetUrl(bgmName) {
    return findAssetUrl('bgm', bgmName);
}

function sfxAssetUrl(sfxName) {
    return findAssetUrl('sfx', sfxName);
}

// 1. Fetch dialogues for a specific story episode
// ฝั่ง server ฝัง assets_preload (asset ที่ chapter นี้ใช้) มาให้ใน response แล้ว
// เราจึงไม่ต้องยิง GET /api/assets ทั้งชุด — โหลด chapter เดียวจบ
async function fetchEpisode(storyId, chapterNumber) {
  const res = await fetch(
    `${CONFIG.API_BASE_URL}/api/stories/${storyId}/chapters/${chapterNumber}/dialogues`
  );

  if (!res.ok) {
    throw new Error(
      `โหลด chapter ${chapterNumber} ไม่สำเร็จ (Story: ${storyId}, Status: ${res.status})`
    );
  }

  const data = await res.json();

  if (Array.isArray(data.assets_preload)) {
    allAssets = data.assets_preload;
  }

  // คืน object เต็ม (รวม dialogue + chaptersExport) ให้ Game Engine ตรวจสถานะ is_exported
  return data;
}
