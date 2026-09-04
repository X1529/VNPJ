// ดึง Sprite Element ณ ตอนเรียกใช้งาน กันปัญหา DOM ยังโหลดไม่เสร็จ
function getSprites() {
    return {
        left: document.querySelector('.left-sprite'),
        center: document.querySelector('.center-sprite'),
        right: document.querySelector('.right-sprite')
    };
}

function clearSprites() {
    const sprites = getSprites();
    Object.values(sprites).forEach(s => {
        if (s) s.classList.remove("show", "dim", "highlight");
    });
}

function showCharacters(characters) {
    clearSprites();
    if (!characters || !Array.isArray(characters) || characters.length === 0) return;

    const sprites = getSprites();

    characters.forEach(c => {
        const position = typeof c === 'object' ? (c.position || 'center') : 'center';
        const img = sprites[position];

        if (img) {
            // Delegate all URL-finding logic to the robust characterAssetUrl function
            const src = typeof characterAssetUrl === 'function' ? characterAssetUrl(c) : '';

            if (src) {
                img.src = src;
                img.classList.add("show");
                if (typeof c === 'object') {
                    img.classList.toggle("highlight", !!c.highlight);
                    img.classList.toggle("dim", !c.highlight);
                }
            }
        }
    });
}

function highlightSprite(position) {
    const sprites = getSprites();
    Object.entries(sprites).forEach(([pos, img]) => {
        if (img) {
            // เคารพค่า highlight จาก showCharacters() — ถ้าตัวละครถูกตั้ง highlight ไว้ ไม่ต้อง dim
            if (img.classList.contains('highlight')) return;
            img.classList.toggle("dim", pos !== position);
        }
    });
}
