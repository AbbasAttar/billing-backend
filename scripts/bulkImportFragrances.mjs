/**
 * Bulk import 70 attar fragrances to Firebase Storage + backend API.
 *
 * Usage:
 *   node scripts/bulkImportFragrances.mjs [--dry-run] [--start=N] [--end=N]
 *
 * Prerequisites:
 *   - Backend running at http://localhost:3001
 *   - Service account JSON at C:\Users\abbas\Downloads\attarwala-46200-adb62f5d6391.json
 *   - Images at C:\Users\abbas\Downloads\(Bulk 1) Musk Rizali\{1-70}.png
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { GoogleAuth } from 'google-auth-library';

// ─── Config ──────────────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = 'C:/Users/abbas/Downloads/attarwala-46200-adb62f5d6391.json';
const IMAGES_DIR           = 'C:/Users/abbas/Downloads/(Bulk 1) Musk Rizali';
const API_BASE             = 'http://localhost:3001/api';
const BUCKET               = 'attarwala-46200.firebasestorage.app';
const STORAGE_FOLDER       = 'fragrances';

const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const startArg    = args.find(a => a.startsWith('--start='));
const endArg      = args.find(a => a.startsWith('--end='));
const START_INDEX = startArg ? parseInt(startArg.split('=')[1]) : 1;
const END_INDEX   = endArg   ? parseInt(endArg.split('=')[1])   : 70;

// ─── Helper ───────────────────────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function roundPrice(p) {
  return Math.round(p / 10) * 10;
}

function sizePrices(base) {
  return { ml12: base, ml6: roundPrice(base * 0.55), ml3: roundPrice(base * 0.30) };
}

// ─── Full fragrance metadata (70 entries, index = CSV row - 1) ───────────────
// Fields: families[], gender, tags[], longevity, shortDesc, longDesc, companyName
const META = [
  // 1. Musk Madina
  {
    families: ['Musk', 'Oriental'],
    gender: 'unisex',
    tags: ['musk', 'traditional', 'medina', 'clean', 'spiritual'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'A luminous white musk steeped in soft oriental warmth — pure, clean and deeply spiritual.',
    longDesc: 'Musk Madina is an evocation of purity and serenity. Opening with radiant white musk, it softens into subtle warm woods and the barest whisper of rose. Light yet enduring, it carries the clean, sacred fragrance reminiscent of the holy city. Ideal for daily wear and heartfelt gifting.',
  },
  // 2. Musk Tahara
  {
    families: ['Musk', 'Floral'],
    gender: 'unisex',
    tags: ['musk', 'clean', 'pure', 'floral', 'light'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Delicate white musk kissed with soft florals — a fragrance of cleanliness and grace.',
    longDesc: 'Tahara (purity) lives up to its name. A soft sheer musk heart is lifted by petals of white jasmine and a cool powdery finish. Neither heavy nor loud, this is the attar you reach for every morning — understated, fresh and always refined.',
  },
  // 3. AOH Vampire
  {
    families: ['Spicy', 'Oriental', 'Woody'],
    gender: 'unisex',
    tags: ['dark', 'bold', 'spicy', 'oud', 'night'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Dark, bold and seductive — an oriental blend of rich spice, deep oud and smoky woods.',
    longDesc: 'AOH Vampire is for those who dare to stand out. A dramatic opening of black pepper and cardamom gives way to a smoky oud core wrapped in dark amber and patchouli. A mysterious, commanding trail makes this the perfect evening or occasion attar.',
  },
  // 4. Atomic Rose
  {
    families: ['Floral', 'Musk'],
    gender: 'women',
    tags: ['rose', 'floral', 'feminine', 'fresh', 'romantic'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'A vivid burst of fresh rose petals anchored by soft clean musk — feminine and radiant.',
    longDesc: 'Atomic Rose is pure floral energy. The heart is a brilliant, dewy rose — almost photorealistic in its freshness — lifted by green top notes and grounded by a sheer clean musk. Ideal for daytime and spring wear, it leaves a soft, romantic trail wherever you go.',
  },
  // 5. Purple Oud
  {
    families: ['Oud', 'Woody', 'Floral'],
    gender: 'unisex',
    tags: ['oud', 'woody', 'violet', 'rich', 'premium'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Velvety oud blended with soft violet and warm woods — luxurious and deeply alluring.',
    longDesc: 'Purple Oud is an oud lover\'s dream. A deep, resinous oud opens with a hint of violet flower, then settles into a rich base of amber, sandalwood and warm woods. Smooth, luxurious and long-lasting — this is an attar for moments that deserve to be remembered.',
  },
  // 6. AOH Caramel
  {
    families: ['Sweet', 'Woody'],
    gender: 'unisex',
    tags: ['sweet', 'caramel', 'vanilla', 'gourmand', 'warm'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Warm, indulgent caramel sweetness over a soft sandalwood base — comforting and cosy.',
    longDesc: 'AOH Caramel is your favourite dessert in fragrance form. A luscious caramel opening deepens into notes of vanilla cream and warm sandalwood, creating an irresistibly cosy and inviting trail. Perfect for cooler evenings and casual wear.',
  },
  // 7. Creed SMW
  {
    families: ['Fresh', 'Aquatic', 'Woody'],
    gender: 'men',
    tags: ['fresh', 'aquatic', 'green-tea', 'clean', 'everyday'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Silver Mountain Water — crisp green tea, black currant and fresh woods.',
    longDesc: 'Our Creed SMW attar captures the invigorating spirit of the legendary Silver Mountain Water. Green tea and bergamot open with sparkling clarity, followed by black currant and a cool wood-sandalwood base. A versatile, all-seasons fresh fragrance that transitions effortlessly from boardroom to weekend.',
  },
  // 8. Burberry Goddess
  {
    families: ['Floral', 'Sweet', 'Musk'],
    gender: 'women',
    tags: ['floral', 'vanilla', 'feminine', 'goddess', 'warm'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Burberry Goddess — warm lavender, honey vanilla and soft floral femininity.',
    longDesc: 'A tribute to the goddess within. Inspired by Burberry Goddess, this attar blends warm lavender and honey with a heart of soft floral notes and a creamy vanilla amber base. Simultaneously soft and powerful — feminine, warm and utterly captivating.',
  },
  // 9. Arabian Oud
  {
    families: ['Oud', 'Oriental', 'Woody'],
    gender: 'unisex',
    tags: ['oud', 'arabic', 'oriental', 'premium', 'traditional'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'The quintessential Arabian oud — rich, smoky and beautifully complex with amber warmth.',
    longDesc: 'Arabian Oud is the heart of the Middle Eastern fragrance tradition. Rich, smoky oud resin opens dramatically and settles into an amber and rose accord of remarkable depth. Worn across the Arabian peninsula for centuries, this attar speaks the language of luxury and heritage.',
  },
  // 10. Rave Now
  {
    families: ['Fresh', 'Spicy', 'Citrus'],
    gender: 'men',
    tags: ['fresh', 'energetic', 'citrus', 'spicy', 'night'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Bold citrus sparks ignite over a spicy, woody heart — made for bold first impressions.',
    longDesc: 'Rave Now is unapologetically alive. Bright citrus bergamot and grapefruit top notes charge into a heart of black pepper and crisp woods, finishing on a warm musky amber base. For those who walk into a room and own it.',
  },
  // 11. One Million
  {
    families: ['Spicy', 'Sweet', 'Woody'],
    gender: 'men',
    tags: ['one-million', 'spicy', 'sweet', 'seductive', 'evening'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Paco Rabanne 1 Million — explosive fresh grapefruit meets spiced leather and wood.',
    longDesc: 'A million-dollar trail without the million-dollar price tag. Our One Million attar captures the iconic DNA of the original: fresh grapefruit and mint burst open, followed by a rich heart of spiced cinnamon and rose, anchored by a warm leather, amber and wood base. Seductive, bold and unforgettable.',
  },
  // 12. 9PM Rebel
  {
    families: ['Spicy', 'Oriental', 'Sweet'],
    gender: 'men',
    tags: ['night', 'spicy', 'oriental', 'seductive', 'evening'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Deep, dark and rebellious — inspired by Afnan 9PM, a spicy amber powerhouse for night.',
    longDesc: '9PM Rebel is what happens when sophistication meets rebellion after dark. An opening of apple and lavender leads into a rich heart of spicy cinnamon and oriental jasmine, finishing on a deep amber, patchouli and vanilla base. It dares you to wear it every single night.',
  },
  // 13. Tobacco Vanilla
  {
    families: ['Sweet', 'Spicy', 'Woody'],
    gender: 'unisex',
    tags: ['tobacco', 'vanilla', 'warm', 'cosy', 'gourmand'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'A rich blend of toasty tobacco leaf and creamy Madagascar vanilla over warm woody spices.',
    longDesc: 'Tobacco Vanilla is the attar equivalent of a fireside evening. Inspired by the iconic Tom Ford blend, this attar combines the cured richness of tobacco leaf with swirls of creamy vanilla, clove and sandalwood. Warm, enveloping and deeply comforting — especially beautiful in cooler weather.',
  },
  // 14. Arabian Tonka
  {
    families: ['Oriental', 'Spicy', 'Musk'],
    gender: 'unisex',
    tags: ['tonka', 'oriental', 'warm', 'spicy', 'almond'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Warm tonka bean sweetness woven through oriental spices — rich, smooth and captivating.',
    longDesc: 'Arabian Tonka brings the warmth of the Arabian night. Soft almond-sweet tonka bean is enriched with cardamom, amber and a whisper of oud, creating a smooth, spiced oriental that feels both exotic and familiar. A beautiful signature fragrance for year-round wear.',
  },
  // 15. AOH GGGB
  {
    families: ['Floral', 'Woody', 'Musk'],
    gender: 'women',
    tags: ['floral', 'feminine', 'bold', 'woody', 'signature'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Kilian Good Girl Gone Bad — a daring floral with rose, jasmine and woods.',
    longDesc: 'AOH GGGB (Good Girl Gone Bad) is a floral statement. Inspired by the legendary Kilian creation, this attar opens with a vivid bouquet of rose, peony and jasmine, then deepens into a warm woods and musk base. Bold, feminine and impossible to ignore.',
  },
  // 16. Bidum Esam
  {
    families: ['Oriental', 'Musk', 'Woody'],
    gender: 'unisex',
    tags: ['arabic', 'oriental', 'musk', 'traditional', 'oud'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'A harmonious oriental blend of musk, amber and soft woods with a timeless Arabic character.',
    longDesc: 'Bidum Esam is a tribute to the classic Arabic perfumery tradition. A soft musk opening warms into amber, sandalwood and a gentle oud base. Balanced and understated, it carries the refined elegance of traditional Arabic fragrance craftsmanship.',
  },
  // 17. Rassasi Hawas
  {
    families: ['Woody', 'Spicy', 'Fresh'],
    gender: 'men',
    tags: ['rasasi', 'hawas', 'woody', 'spicy', 'fresh', 'masculine'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'Rasasi',
    shortDesc: 'Inspired by Rasasi Hawas — fresh sea breeze, spicy cedar and virile woody intensity.',
    longDesc: 'Hawas (Arabic for "obsession of the senses") is a modern masculine icon. An invigorating opening of fresh citrus and sea spray gives way to a spicy heart of cardamom, pink pepper and cedar, before landing on a bold, smoky patchouli and amber base. Confident, vibrant and deeply compelling.',
  },
  // 18. AOH Mitti
  {
    families: ['Woody', 'Fresh', 'Spicy'],
    gender: 'unisex',
    tags: ['mitti', 'petrichor', 'earthy', 'rain', 'unique', 'nature'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'The magical scent of earth after the first monsoon rain — petrichor, clay and vetiver.',
    longDesc: 'Mitti (meaning "soil" or "earth") is one of the most evocative and uniquely South Asian fragrances in existence. Our AOH Mitti captures the ineffable magic of petrichor — the scent of dry earth meeting rainwater. A cool clay opening settles into warm vetiver and woody base notes, evoking monsoon memories with every breath.',
  },
  // 19. Oud Of Greatness
  {
    families: ['Oud', 'Woody', 'Oriental'],
    gender: 'unisex',
    tags: ['oud', 'premium', 'greatness', 'luxury', 'rich'],
    longevity: 'Very Strong (8+ hrs)',
    companyName: 'AOH',
    shortDesc: 'Premium aged oud at its most majestic — deep, resinous and powerfully long-lasting.',
    longDesc: 'Oud Of Greatness lives up to every syllable of its name. This is AOH\'s expression of oud in its highest form — dark, resinous, slightly smoky with a richness that unfolds over hours. Layered over a base of amber and warm leather, the oud here is patient, complex and utterly commanding. A fragrance for those who never settle for less.',
  },
  // 20. Jannat Ul Firdoz
  {
    families: ['Floral', 'Musk', 'Sweet'],
    gender: 'unisex',
    tags: ['jannat', 'paradise', 'floral', 'musk', 'heavenly', 'light'],
    longevity: 'Light (2–4 hrs)',
    companyName: 'AOH',
    shortDesc: 'Heavenly light florals and white musk — a blissful, airy scent inspired by paradise.',
    longDesc: 'Jannat Ul Firdoz (Garden of Paradise) is as close to heaven as a fragrance can get. A soft, ethereal blend of white florals — rose, lily and jasmine — drifts on a bed of clean white musk with the lightest touch of sweet sandalwood. Gentle, blissful and effortlessly beautiful.',
  },
  // 21. Dior Sauvage
  {
    families: ['Fresh', 'Woody', 'Spicy'],
    gender: 'men',
    tags: ['sauvage', 'fresh', 'woody', 'masculine', 'bergamot', 'everyday'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Dior Sauvage — raw bergamot, Sichuan pepper and ambroxan over grey woods.',
    longDesc: 'Our Dior Sauvage attar captures the wild, open-sky spirit of the iconic original. Bergamot and fresh Sichuan pepper explode at the top, settling into a grey woody heart of pepper, lavender and iris. The signature ambroxan warmth makes this one of the most versatile, wearable men\'s fragrances in any collection.',
  },
  // 22. Burberry Her
  {
    families: ['Floral', 'Fresh', 'Fruity'],
    gender: 'women',
    tags: ['burberry', 'her', 'floral', 'fresh', 'berry', 'feminine'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Burberry Her — bright berry accord, fresh jasmine and warm woody musk.',
    longDesc: 'Inspired by Burberry Her, this attar opens with a vibrant medley of red berries and crisp apple, softening into a heart of jasmine and violet. The dry-down reveals a warm, woody amber musk that is both modern and deeply wearable. Fresh, floral and full of youthful energy.',
  },
  // 23. Most Wanted
  {
    families: ['Spicy', 'Oriental', 'Woody'],
    gender: 'men',
    tags: ['most-wanted', 'spicy', 'oriental', 'amber', 'bold', 'masculine'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Azzaro Most Wanted — explosive spice, dry amber and warm lavender.',
    longDesc: 'AOH Most Wanted is the attar for those who demand attention. Inspired by Azzaro\'s iconic fragrance, an opening of warm cinnamon and bergamot charges into a heart of bourbon lavender and tonka, before landing on a deep amber and cedar base. Unapologetically bold, seductive and memorable.',
  },
  // 24. Oud Mitti
  {
    families: ['Oud', 'Woody', 'Fresh'],
    gender: 'unisex',
    tags: ['oud', 'mitti', 'earthy', 'petrichor', 'unique', 'deep'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'The mesmerising union of premium oud and petrichor — earthy, deep and beautifully complex.',
    longDesc: 'Oud Mitti marries two of the most primal, evocative scents in nature. Rich oud resin meets the cool earthiness of clay and rain-soaked soil. As it develops, warm woody base notes emerge, creating a fragrance that feels ancient, natural and utterly mesmerising. A true connoisseur\'s attar.',
  },
  // 25. Creed Viking
  {
    families: ['Fresh', 'Woody', 'Citrus'],
    gender: 'men',
    tags: ['creed', 'viking', 'fresh', 'spicy', 'citrus', 'masculine'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Creed Viking — Nordic citrus, crushed spice and smooth sandalwood power.',
    longDesc: 'Our Creed Viking attar distils the energy of Nordic power into a fragrance. Bergamot and pink pepper open brightly, leading into a heart of lavender, geranium and spice, before a smooth sandalwood and vetiver base adds gravity and depth. Bold, clean and powerfully masculine.',
  },
  // 26. Ruh Kastoori
  {
    families: ['Musk', 'Oriental', 'Woody'],
    gender: 'unisex',
    tags: ['kasturi', 'musk', 'deer-musk', 'traditional', 'oriental', 'natural'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Traditional deer musk (kasturi) attar — the purest, most prized musk in classical perfumery.',
    longDesc: 'Ruh Kastoori is one of the most revered attars in Islamic and South Asian perfumery traditions. Kasturi (deer musk) has been treasured for centuries for its warm, animalic depth and extraordinary tenacity. This blend captures its rich, animalic musk softened by warm amber and a woody base — deeply traditional and unforgettable.',
  },
  // 27. Tiger Oud
  {
    families: ['Oud', 'Spicy', 'Woody'],
    gender: 'unisex',
    tags: ['oud', 'tiger', 'spicy', 'bold', 'powerful', 'premium'],
    longevity: 'Very Strong (8+ hrs)',
    companyName: 'AOH',
    shortDesc: 'Fierce, powerful oud ignited with spice and smoke — commanding and deeply masculine.',
    longDesc: 'Tiger Oud is bold without apology. An opening of sharp black pepper and saffron ignites the rich, smoky oud heart that forms the centrepiece of this attar. Patchouli and dark amber in the base amplify the intensity, creating a trail that is assertive, powerful and memorable from first spray to last.',
  },
  // 28. Mukhallat Gold
  {
    families: ['Oud', 'Oriental', 'Floral'],
    gender: 'unisex',
    tags: ['mukhallat', 'gold', 'oud', 'oriental', 'premium', 'blend', 'luxury'],
    longevity: 'Very Strong (8+ hrs)',
    companyName: 'AOH',
    shortDesc: 'A regal oriental mukhallat blend — golden oud, rose, amber and exotic spices.',
    longDesc: 'Mukhallat Gold is AOH\'s premium signature blend (mukhallat means "mixed" in Arabic). This opulent composition weaves together aged oud, Bulgarian rose, saffron, amber and sandalwood into a fragrance of extraordinary depth and complexity. Fit for royalty — worn when nothing but the best will do.',
  },
  // 29. Oud Wood
  {
    families: ['Oud', 'Woody', 'Spicy'],
    gender: 'unisex',
    tags: ['oud', 'wood', 'tom-ford', 'sandalwood', 'versatile', 'premium'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Tom Ford Oud Wood — rare oud, sandalwood, cardamom and smoky vetiver.',
    longDesc: 'Inspired by the legendary Tom Ford Oud Wood, this attar captures the same hypnotic blend of rare oud, richly aromatic rosewood and sandalwood with a heart of spiced cardamom. The smoky vetiver base gives it gravity and longevity. Impossibly smooth and effortlessly sophisticated — the perfect everyday luxury.',
  },
  // 30. Tam Doa
  {
    families: ['Woody', 'Citrus', 'Fresh'],
    gender: 'unisex',
    tags: ['tam-dao', 'sandalwood', 'woody', 'citrus', 'fresh', 'light'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Diptyque Tam Dao — Vietnamese sandalwood, woody spice and bright cedar.',
    longDesc: 'Inspired by Diptyque\'s Tam Dao, this attar is an ode to the rare Vietnamese sandalwood. Bright citrus bergamot opens cleanly, leading into a heart of warm, creamy sandalwood and cedar. A whisper of woody spice in the base adds just enough complexity. Clean, elegant and effortlessly sophisticated — a connoisseur\'s everyday fragrance.',
  },
  // 31. Oud Mood
  {
    families: ['Oud', 'Woody', 'Oriental'],
    gender: 'unisex',
    tags: ['oud', 'premium', 'mood', 'luxury', 'deep', 'complex'],
    longevity: 'Very Strong (8+ hrs)',
    companyName: 'AOH',
    shortDesc: 'An immersive, mood-altering oud experience — deep, complex and impossibly luxurious.',
    longDesc: 'Oud Mood is an invitation to get lost in pure oud perfumery. This premium composition opens with dark, resinous oud, layered over roses and saffron in the heart, and settling into a deep amber, labdanum and musk base. Rich, enveloping and profoundly long-lasting — wear it when you want to set the mood.',
  },
  // 32. Gucci Flora
  {
    families: ['Floral', 'Fresh', 'Citrus'],
    gender: 'women',
    tags: ['gucci', 'flora', 'floral', 'feminine', 'fresh', 'rose', 'peony'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Gucci Flora — a lush bouquet of rose, peony and dewy citrus freshness.',
    longDesc: 'Our Gucci Flora attar is a celebration of femininity in full bloom. Bright mandarin and citrus open the fragrance before a stunning heart of rose, peony and magnolia takes centre stage. A clean sandalwood and musk dry-down keeps everything beautifully fresh and wearable. Elegant, feminine and timelessly lovely.',
  },
  // 33. Zam Zam
  {
    families: ['Musk', 'Floral', 'Fresh'],
    gender: 'unisex',
    tags: ['zam-zam', 'musk', 'pure', 'spiritual', 'clean', 'holy'],
    longevity: 'Light (2–4 hrs)',
    companyName: 'AOH',
    shortDesc: 'Pure, clean and spiritually serene — a soft musk with cool freshness named after sacred water.',
    longDesc: 'Named after the blessed Zam Zam water, this attar embodies purity and grace. A cool, clean opening of fresh aquatic notes blends with soft white musk and a hint of sweet floral. Light, innocent and uplifting — perfect for prayer and everyday wear. A fragrance for the soul.',
  },
  // 34. Black Orchid
  {
    families: ['Floral', 'Oriental', 'Spicy'],
    gender: 'unisex',
    tags: ['black-orchid', 'dark-floral', 'oriental', 'spicy', 'tom-ford', 'luxury'],
    longevity: 'Very Strong (8+ hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Tom Ford Black Orchid — dark florals, truffle, patchouli and ylang-ylang.',
    longDesc: 'Inspired by Tom Ford\'s iconic Black Orchid, this attar is glamorous, dark and utterly captivating. Rich black orchid and truffle form the dramatic heart, surrounded by ylang-ylang and spiced plum, over a deep base of patchouli, black amber and dark chocolate. Luxurious, provocative and memorably unique.',
  },
  // 35. Channel BDC
  {
    families: ['Fresh', 'Woody', 'Citrus'],
    gender: 'men',
    tags: ['bleu-de-chanel', 'fresh', 'woody', 'citrus', 'masculine', 'versatile'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Chanel Bleu de Chanel — crisp citrus, clean labdanum and aromatic woods.',
    longDesc: 'AOH Channel BDC is inspired by the timeless Bleu de Chanel. Fresh citrus bergamot and lemon open with impeccable clarity, evolving into a heart of grapefruit, ginger and labdanum. The dry-down of sandalwood, cedar and vetiver lends the kind of quiet confidence that never goes out of style. A true all-day, all-season gentleman\'s attar.',
  },
  // 36. Kashmiri Oud
  {
    families: ['Oud', 'Woody', 'Oriental'],
    gender: 'unisex',
    tags: ['kashmir', 'oud', 'premium', 'luxury', 'artisan', 'top-seller'],
    longevity: 'Very Strong (8+ hrs)',
    companyName: 'AOH',
    shortDesc: 'AOH\'s finest oud — a rare Kashmiri expression with saffron, rose and majestic depth.',
    longDesc: 'Kashmiri Oud is AOH\'s crown jewel. This premium composition draws inspiration from the valley of Kashmir, weaving together the finest oud resin with threads of saffron, Kashmiri rose and warm amber. The result is a fragrance of staggering depth and longevity — complex, regal and truly unforgettable. For occasions that deserve the very best.',
  },
  // 37. Ferrari Red
  {
    families: ['Fresh', 'Citrus', 'Aquatic'],
    gender: 'men',
    tags: ['ferrari', 'red', 'fresh', 'citrus', 'aquatic', 'clean', 'sporty'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Ferrari Red — bright Italian citrus, fresh woods and a clean aquatic heart.',
    longDesc: 'AOH Ferrari Red channels the spirit of Italian speed and elegance. Sparkling notes of citrus, bergamot and lemon zoom open before a fresh aquatic heart of sea breeze and jasmine. A clean, woody cedar base gives it form. Energetic, stylish and effortlessly modern — for men who move fast and smell great doing it.',
  },
  // 38. Mukhallat Badar
  {
    families: ['Oriental', 'Floral', 'Oud'],
    gender: 'unisex',
    tags: ['mukhallat', 'badar', 'oriental', 'premium', 'rose', 'oud', 'luxury'],
    longevity: 'Very Strong (8+ hrs)',
    companyName: 'AOH',
    shortDesc: 'A grand oriental mukhallat blend named after the moon — oud, rose, amber and rich spices.',
    longDesc: 'Mukhallat Badar (full moon) is AOH\'s prestige oriental blend. This exquisite composition combines aged oud resin, Bulgarian rose, amber and warm saffron in perfect balance. The result radiates the luminous complexity of a full moon night — rich, glowing and impossible to ignore. A collector\'s attar and a supremely special gift.',
  },
  // 39. Turkish Oud
  {
    families: ['Oud', 'Woody', 'Spicy'],
    gender: 'unisex',
    tags: ['turkish', 'oud', 'spicy', 'woody', 'oriental', 'premium'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Turkish-inspired oud with warm rose, cardamom and a deep amber-sandalwood base.',
    longDesc: 'Turkish Oud brings the rich fragrance culture of Istanbul to your skin. Warm, spiced oud opens with notes of cardamom and Turkish rose, deepening into a smooth base of amber, sandalwood and musk. Sensual, rich and beautifully crafted — a journey to the spice markets of the Bosphorus.',
  },
  // 40. Green Apple
  {
    families: ['Fresh', 'Citrus', 'Fruity'],
    gender: 'unisex',
    tags: ['green-apple', 'fresh', 'fruity', 'light', 'fun', 'everyday'],
    longevity: 'Light (2–4 hrs)',
    companyName: 'AOH',
    shortDesc: 'A burst of crisp, freshly-picked green apple — light, fruity and instantly refreshing.',
    longDesc: 'AOH Green Apple is pure, uncomplicated joy. The opening is a bright, tart green apple accord — imagine biting into a freshly-picked Granny Smith. A clean, airy white musk base keeps it fresh and effortless. Great for warm days, casual outings and anyone who loves light, happy fragrances.',
  },
  // 41. Oud Isphan
  {
    families: ['Oud', 'Floral', 'Woody'],
    gender: 'unisex',
    tags: ['oud', 'rose', 'isphan', 'ysl', 'floral-oud', 'premium'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by YSL Oud Ispahan — rich Damascena rose wrapped in smoky oud and patchouli.',
    longDesc: 'Inspired by YSL\'s legendary Oud Ispahan, this attar weaves the rich Damascena rose of Ispahan, Iran with smoky, resinous oud and a deep patchouli base. The rose here is not delicate — it is lush, saturated and almost edible. Paired with the oud\'s dry smokiness, the result is a floral-oriental of extraordinary beauty and depth.',
  },
  // 42. Ombre Leather
  {
    families: ['Woody', 'Spicy', 'Musk'],
    gender: 'unisex',
    tags: ['leather', 'spicy', 'woody', 'tom-ford', 'bold', 'masculine'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Tom Ford Ombré Leather — smoky leather, black pepper and jasmine over patchouli.',
    longDesc: 'Inspired by Tom Ford\'s bold Ombré Leather, this attar opens with a striking accord of black pepper, cardamom and a whisper of jasmine, quickly giving way to the commanding leather heart. Patchouli and vetiver in the base add depth and a slightly smoky drydown. Daring, refined and deeply satisfying.',
  },
  // 43. Lattafa Khamra
  {
    families: ['Sweet', 'Fruity', 'Oriental'],
    gender: 'unisex',
    tags: ['lattafa', 'khamra', 'sweet', 'fruity', 'grape', 'oriental', 'fun'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'Lattafa',
    shortDesc: 'Inspired by Lattafa Khamra — juicy grape, sweet berries and warm oriental amber.',
    longDesc: 'Khamra (Arabic for "wine") is playful, sweet and utterly addictive. Inspired by Lattafa\'s much-loved creation, this attar opens with luscious grape and berry accord, sweetened by caramel and vanilla, over a warm oriental amber base. Fun, indulgent and a guaranteed crowd-pleaser — especially among younger fragrance lovers.',
  },
  // 44. Imperial Valley
  {
    families: ['Fresh', 'Oriental', 'Woody'],
    gender: 'unisex',
    tags: ['imperial', 'fresh', 'oriental', 'woody', 'elegant', 'versatile'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'A regal, refined blend of fresh citrus, warm oriental spices and noble woods.',
    longDesc: 'Imperial Valley evokes grandeur and wide open skies. A fresh bergamot and green opening settles into a warm oriental heart of amber and spice, finished by a clean, noble wood base. The balance between freshness and warmth makes it equally at home in day or evening wear — versatile, polished and quietly impressive.',
  },
  // 45. Ajmal Auram
  {
    families: ['Musk', 'Woody', 'Oriental'],
    gender: 'unisex',
    tags: ['ajmal', 'auram', 'musk', 'woody', 'oriental', 'signature'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'Ajmal',
    shortDesc: 'Inspired by Ajmal Auram — a subtle, refined musk with soft woods and oriental warmth.',
    longDesc: 'Ajmal Auram is a fragrance of quiet sophistication. This attar follows the refined Ajmal tradition — a soft, animalic musk is enriched by warm sandalwood, amber and the subtle warmth of oriental spice. Understated but deeply memorable, it leaves a trail that invites people closer.',
  },
  // 46. Naseem Burhan
  {
    families: ['Fresh', 'Woody', 'Musk'],
    gender: 'unisex',
    tags: ['naseem', 'burhan', 'fresh', 'breeze', 'woody', 'light'],
    longevity: 'Light (2–4 hrs)',
    companyName: 'Naseem',
    shortDesc: 'A fresh, breezy blend of clean woods and soft musk — light and effortlessly everyday.',
    longDesc: 'Naseem Burhan (breeze of evidence) is as light as its name suggests. A fresh, clean opening of bergamot and green tea drifts over a soft woody heart, finishing on a gentle white musk. Effortless, unpretentious and always welcome — the attar you throw on before stepping out into a sunny morning.',
  },
  // 47. Naseem Muffadal
  {
    families: ['Fresh', 'Floral', 'Musk'],
    gender: 'unisex',
    tags: ['naseem', 'muffadal', 'fresh', 'floral', 'light', 'clean'],
    longevity: 'Light (2–4 hrs)',
    companyName: 'Naseem',
    shortDesc: 'Delicate fresh florals with a clean musk finish — soft, elegant and perfectly balanced.',
    longDesc: 'Naseem Muffadal is a gentle, composed floral fresh attar. Rose water and jasmine blossom are brightened by a clean citrus top and grounded by a soft musk. Simple yet beautiful — like the freshness of morning air through an open window. A wonderful gift for anyone who loves light, clean fragrances.',
  },
  // 48. Shy Oud
  {
    families: ['Oud', 'Woody', 'Musk'],
    gender: 'unisex',
    tags: ['oud', 'shy', 'soft', 'premium', 'subtle', 'woody'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'A premium, gently-whispered oud — soft, smooth and refined with clean musky woods.',
    longDesc: 'Shy Oud is the anti-loud oud. Where many ouds announce themselves, this one leans in quietly. The oud here is silky, refined and blended seamlessly with soft sandalwood and clean white musk. The result is intimate, sophisticated and captivating in the most understated way — the signature of true luxury.',
  },
  // 49. Cocoa Vanilla
  {
    families: ['Sweet', 'Woody'],
    gender: 'unisex',
    tags: ['cocoa', 'vanilla', 'chocolate', 'sweet', 'gourmand', 'warm'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Luscious dark cocoa and rich vanilla cream over a soft warm sandalwood — indulgent and cosy.',
    longDesc: 'AOH Cocoa Vanilla is a warm hug in fragrance form. Rich dark cocoa opens luxuriously, deepened by creamy Madagascar vanilla and a whisper of tonka bean. A soft sandalwood base keeps it warm and skin-close. Sweet but never overwhelming — perfect for cooler days and cosy evenings.',
  },
  // 50. AOH BR540
  {
    families: ['Floral', 'Woody', 'Sweet'],
    gender: 'unisex',
    tags: ['br540', 'baccarat', 'floral', 'woody', 'amber', 'luxury', 'best-seller'],
    longevity: 'Very Strong (8+ hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Baccarat Rouge 540 — saffron, jasmine, cedarwood and warm ambergris.',
    longDesc: 'AOH BR540 is inspired by the legendary Maison Francis Kurkdjian Baccarat Rouge 540 — consistently ranked among the world\'s most admired fragrances. Saffron and jasmine shimmer at the opening, while cedarwood and ambergris create the iconic warm, mineral drydown. Addictive, luxurious and breathtakingly long-lasting. One of our most requested attars.',
  },
  // 51. Aqua Di Geo
  {
    families: ['Aquatic', 'Fresh', 'Citrus'],
    gender: 'men',
    tags: ['acqua-di-gio', 'aquatic', 'fresh', 'marine', 'clean', 'summer'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Acqua di Giò — Mediterranean sea air, crisp citrus and a clean fresh heart.',
    longDesc: 'Our Aqua Di Geo attar captures the soul of Acqua di Giò — one of the best-selling men\'s fragrances of all time. The opening is pure Mediterranean: sea spray, bergamot and marine accord. A clean, aromatic heart of jasmine and rosemary settles over a light musky wood base. Fresh, effortless and timeless.',
  },
  // 52. Rassasi Ice
  {
    families: ['Fresh', 'Aquatic', 'Woody'],
    gender: 'men',
    tags: ['rasasi', 'ice', 'fresh', 'cool', 'aquatic', 'woody', 'masculine'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'Rasasi',
    shortDesc: 'Inspired by Rasasi Ice — a cool arctic blast of fresh citrus, mint and clean woody notes.',
    longDesc: 'Rassasi Ice is the cool blast you need. An icy opening of frozen mint and bergamot rushes over a fresh aquatic heart with eucalyptus and green notes. Clean cedar and musk in the base keep it masculine and grounded. Invigorating, cool and perfect for summer heat or air-conditioned offices.',
  },
  // 53. Mukhallat Faris
  {
    families: ['Oriental', 'Spicy', 'Woody'],
    gender: 'men',
    tags: ['mukhallat', 'faris', 'oriental', 'spicy', 'masculine', 'knight'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'A bold knight\'s blend — spiced amber, oud and cedarwood for the man of courage.',
    longDesc: 'Faris (Arabic for "knight") is a bold, masculine oriental blend crafted for those who carry themselves with honour. Warm spices — cardamom, cinnamon and clove — open dramatically, settling into a heart of oud and rose over a deep amber and cedar base. Confident, powerful and deeply aromatic.',
  },
  // 54. Oud Kalimat
  {
    families: ['Oud', 'Woody', 'Oriental'],
    gender: 'unisex',
    tags: ['oud', 'kalimat', 'lattafa', 'woody', 'oriental', 'rich'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Kalimat — warm oud, amber and sandalwood in a classic oriental composition.',
    longDesc: 'Inspired by Kalimat\'s rich oriental tradition, Oud Kalimat is a classic. Warm, resinous oud opens boldly and deepens into a heart of amber, Bulgarian rose and sandalwood. The dry-down is smooth, warm and enveloping. Rich without being heavy — a beautifully balanced oud attar for daily luxury.',
  },
  // 55. AOH Gulab
  {
    families: ['Floral', 'Fresh'],
    gender: 'unisex',
    tags: ['gulab', 'rose', 'floral', 'fresh', 'pure', 'traditional'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Authentic rose (gulab) attar — the pure, dewy essence of freshly-picked Damask roses.',
    longDesc: 'AOH Gulab is pure rose perfumery at its finest. Gulab (rose in Urdu/Hindi) is distilled directly from Damask rose petals, capturing the flower in its most authentic form. No synthetics, no additions — just the clean, slightly honeyed, green-tinged freshness of real rose. A traditional attar of timeless beauty.',
  },
  // 56. AOH Mogra
  {
    families: ['Floral', 'Fresh', 'Sweet'],
    gender: 'unisex',
    tags: ['mogra', 'jasmine', 'floral', 'sweet', 'night-blooming', 'traditional'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Pure mogra (jasmine) attar — heady, intoxicating and deeply traditional.',
    longDesc: 'AOH Mogra celebrates the beloved mogra flower — the night-blooming Arabian jasmine beloved across South Asia. Our Mogra attar captures its heady, slightly indolic sweetness with a green, freshly-picked quality. Jasmine lovers, this is the real thing. Beautiful in the evening or as part of a layering composition.',
  },
  // 57. AOH Chandan
  {
    families: ['Woody', 'Fresh', 'Sweet'],
    gender: 'unisex',
    tags: ['chandan', 'sandalwood', 'woody', 'creamy', 'traditional', 'calming'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Authentic sandalwood (chandan) attar — creamy, smooth and meditative.',
    longDesc: 'AOH Chandan is a pure sandalwood attar inspired by the creamy, meditative quality of genuine Mysore sandalwood. Soft, warm and slightly sweet, this is the attar to reach for when you want calm, centred and natural. Wonderful for meditation, prayer or any moment calling for peace. Layers beautifully with florals and musks.',
  },
  // 58. Supreme Lux
  {
    families: ['Oriental', 'Floral', 'Musk'],
    gender: 'unisex',
    tags: ['supreme', 'luxury', 'oriental', 'floral', 'premium', 'signature'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'An opulent oriental floral — rich rose, warm amber and soft musk in a luxe composition.',
    longDesc: 'Supreme Lux is designed for those who want to feel exceptional without shouting about it. A warm, rose-led heart is lifted by bergamot and sweet jasmine, sitting over a refined amber and sandalwood base with a soft, enveloping musk. A signature scent that announces quiet luxury.',
  },
  // 59. AOH Ponds
  {
    families: ['Fresh', 'Floral', 'Musk'],
    gender: 'unisex',
    tags: ['ponds', 'fresh', 'floral', 'light', 'everyday', 'clean'],
    longevity: 'Light (2–4 hrs)',
    companyName: 'AOH',
    shortDesc: 'A light, fresh floral musk inspired by the clean freshness of Pond\'s cream — gentle and familiar.',
    longDesc: 'AOH Ponds is comfort in a bottle — evoking the familiar, clean freshness of the beloved Pond\'s Cold Cream. Soft rose, jasmine and powdery white musk blend together in a light, skin-close attar that feels like freshly moisturised skin. Perfectly everyday, wonderfully comforting.',
  },
  // 60. Oud Agar
  {
    families: ['Oud', 'Woody', 'Oriental'],
    gender: 'unisex',
    tags: ['oud', 'agarwood', 'woody', 'natural', 'traditional', 'premium'],
    longevity: 'Very Strong (8+ hrs)',
    companyName: 'AOH',
    shortDesc: 'Pure agarwood (agar) essence — smoky, resinous and timelessly natural.',
    longDesc: 'Oud Agar is as natural as oud gets. Agarwood (agar) forms the entirety of this composition — smoky, resinous and with the dark, complex character that only true agarwood possesses. A thin skin of amber and musk in the base anchors the oud without hiding it. For the purist who wants nothing between them and the wood.',
  },
  // 61. Oud Amber
  {
    families: ['Oud', 'Oriental', 'Spicy'],
    gender: 'unisex',
    tags: ['oud', 'amber', 'oriental', 'warm', 'spicy', 'rich'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Rich oud warmed by golden amber and soft oriental spice — luxurious and inviting.',
    longDesc: 'Oud Amber is the pairing that was always meant to be. Deep, resinous oud finds its perfect companion in warm, golden amber, spiced with cardamom and sweetened with a touch of vanilla. The result is a warm, inviting oriental that wraps around you like a cashmere shawl. Rich, comforting and profoundly elegant.',
  },
  // 62. AOH Kamal
  {
    families: ['Floral', 'Aquatic', 'Fresh'],
    gender: 'unisex',
    tags: ['kamal', 'lotus', 'floral', 'aquatic', 'clean', 'light'],
    longevity: 'Light (2–4 hrs)',
    companyName: 'AOH',
    shortDesc: 'A serene lotus (kamal) attar — cool aquatic florals with dewy freshness and soft musk.',
    longDesc: 'Kamal (lotus) carries the serenity of a still pond at dawn. Our Kamal attar captures the aquatic, lightly sweet quality of the lotus flower — cool green freshness, clean floral petals and a dewy musk base. Delicate, meditative and perfect for those who love light, natural fragrances.',
  },
  // 63. AOH Charli
  {
    families: ['Floral', 'Fresh', 'Sweet'],
    gender: 'women',
    tags: ['charli', 'floral', 'fresh', 'feminine', 'light', 'sweet', 'fun'],
    longevity: 'Light (2–4 hrs)',
    companyName: 'AOH',
    shortDesc: 'Bright, sweet florals with a sparkling fresh twist — playful, feminine and joyful.',
    longDesc: 'AOH Charli is young, cheerful and completely charming. A bright opening of sweet fruity florals — peach blossom, rose and apple — dances over a light musk and sandalwood base. Effervescent and fun, this is the attar for girls who love scents that match their smile.',
  },
  // 64. Raat Rani
  {
    families: ['Floral', 'Sweet', 'Musk'],
    gender: 'women',
    tags: ['raat-rani', 'night-queen', 'floral', 'nocturnal', 'sweet', 'feminine'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'The intoxicating night queen flower — heady, nocturnal florals with warm vanilla musk.',
    longDesc: 'Raat Rani (Queen of the Night) blooms only after dark, and this attar captures that nocturnal magic. The night queen flower\'s distinctive, slightly heady sweetness is enriched by jasmine and tuberose, warmed by creamy vanilla and clean musk. Deeply feminine, romantic and best worn as the stars come out.',
  },
  // 65. AOH Khus
  {
    families: ['Woody', 'Fresh', 'Earthy'],
    gender: 'unisex',
    tags: ['khus', 'vetiver', 'earthy', 'woody', 'cooling', 'natural', 'summer'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Traditional khus (vetiver) attar — cool, earthy and deeply rooted in South Asian tradition.',
    longDesc: 'Khus (vetiver) is one of the oldest and most revered fragrance ingredients in South Asia, traditionally worn as a cooling summer attar. AOH Khus distils the fresh, earthy, slightly woody character of vetiver root — cool on the skin, deeply grounding for the spirit. A summer essential with centuries of heritage.',
  },
  // 66. Black Oud
  {
    families: ['Oud', 'Woody', 'Spicy'],
    gender: 'unisex',
    tags: ['black-oud', 'dark', 'smoky', 'intense', 'woody', 'bold'],
    longevity: 'Very Strong (8+ hrs)',
    companyName: 'AOH',
    shortDesc: 'Intensely dark and smoky oud with black resin, leather accord and smouldering spice.',
    longDesc: 'Black Oud is oud at its most intense. This is a dark, dramatic fragrance — smoky black resin and smouldering oud are joined by a leather accord and black pepper, creating a deep, commanding trail that announces its presence before you enter a room. For those who wear their confidence like armour.',
  },
  // 67. AOH Magnet
  {
    families: ['Woody', 'Fresh', 'Musk'],
    gender: 'men',
    tags: ['magnet', 'fresh', 'woody', 'clean', 'masculine', 'everyday'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'A clean, magnetic freshness — crisp woods, cooling herbs and a warm musk trail.',
    longDesc: 'AOH Magnet is designed to draw people in. An energetic opening of bergamot and mint gives way to a clean aromatic heart of herbs and cedar, finishing on a warm, skin-close musk. Versatile, everyday and always appealing — it lives up to its name by leaving people wondering what you\'re wearing.',
  },
  // 68. AOH Brute
  {
    families: ['Spicy', 'Fresh', 'Woody'],
    gender: 'men',
    tags: ['brute', 'masculine', 'bold', 'spicy', 'fresh', 'strong'],
    longevity: 'Moderate (4–6 hrs)',
    companyName: 'AOH',
    shortDesc: 'Classic brute masculinity — sharp citrus, lavender fougère and bold woody spice.',
    longDesc: 'AOH Brute is a nod to the classic old-school masculine fougère. A bright citrus and lavender opening charges into a heart of aromatic herbs and juniper, landing on a bold woody and amber base. Classic, no-nonsense and powerfully masculine — for the man who knows exactly who he is.',
  },
  // 69. AOH Poision
  {
    families: ['Spicy', 'Oriental', 'Floral'],
    gender: 'women',
    tags: ['poison', 'spicy', 'oriental', 'dark-floral', 'bold', 'feminine'],
    longevity: 'Strong (6–8 hrs)',
    companyName: 'AOH',
    shortDesc: 'Inspired by Dior Poison — dark plum, wild rose, amber and intoxicating oriental spice.',
    longDesc: 'AOH Poison is gloriously dark and feminine. Inspired by the iconic Dior Poison, this attar opens with lush dark plum and berry, deepening into a heart of wild rose and tuberose with a touch of cinnamon. Warm amber and sandalwood in the base create a powerfully seductive trail. Dangerous in the best possible way.',
  },
  // 70. Musk Rizali
  {
    families: ['Musk', 'Oriental', 'Woody'],
    gender: 'unisex',
    tags: ['musk', 'rizali', 'premium', 'oriental', 'luxury', 'signature', 'top-seller'],
    longevity: 'Very Strong (8+ hrs)',
    companyName: 'AOH',
    shortDesc: 'AOH\'s premium musk — a rich, complex oriental musk with amber, rose and warm woods.',
    longDesc: 'Musk Rizali is AOH\'s flagship musk composition and one of our top-requested attars. This premium blend combines a deeply rich, animalic musk with layers of Bulgarian rose, warm amber and smooth sandalwood, lifted by a thread of saffron. Complex, warm and extraordinarily long-lasting — it is the musk that redefines what musk can be.',
  },
];

// CSV data (name, price) — 70 entries in order
const FRAGRANCES = [
  { name: 'Musk Madina', price: 600 },
  { name: 'Musk Tahara', price: 800 },
  { name: 'AOH Vampire', price: 600 },
  { name: 'Atomic Rose', price: 600 },
  { name: 'Purple Oud', price: 600 },
  { name: 'AOH Caramel', price: 400 },
  { name: 'Creed SMW', price: 600 },
  { name: 'Burberry Goddess', price: 600 },
  { name: 'Arabian Oud', price: 800 },
  { name: 'Rave Now', price: 600 },
  { name: 'One Million', price: 600 },
  { name: '9PM Rebel', price: 600 },
  { name: 'Tobacco Vanilla', price: 600 },
  { name: 'Arabian Tonka', price: 600 },
  { name: 'AOH GGGB', price: 600 },
  { name: 'Bidum Esam', price: 600 },
  { name: 'Rassasi Hawas', price: 600 },
  { name: 'AOH Mitti', price: 800 },
  { name: 'Oud Of Greatness', price: 800 },
  { name: 'Jannat Ul Firdoz', price: 500 },
  { name: 'Dior Sauvage', price: 600 },
  { name: 'Burberry Her', price: 600 },
  { name: 'Most Wanted', price: 800 },
  { name: 'Oud Mitti', price: 800 },
  { name: 'Creed Viking', price: 800 },
  { name: 'Ruh Kastoori', price: 600 },
  { name: 'Tiger Oud', price: 800 },
  { name: 'Mukhallat Gold', price: 800 },
  { name: 'Oud Wood', price: 800 },
  { name: 'Tam Doa', price: 800 },
  { name: 'Oud Mood', price: 1000 },
  { name: 'Gucci Flora', price: 800 },
  { name: 'Zam Zam', price: 600 },
  { name: 'Black Orchid', price: 1000 },
  { name: 'Channel BDC', price: 600 },
  { name: 'Kashmiri Oud', price: 1600 },
  { name: 'Ferrari Red', price: 600 },
  { name: 'Mukhallat Badar', price: 1200 },
  { name: 'Turkish Oud', price: 600 },
  { name: 'Green Apple', price: 600 },
  { name: 'Oud Isphan', price: 800 },
  { name: 'Ombre Leather', price: 600 },
  { name: 'Lattafa Khamra', price: 800 },
  { name: 'Imperial Valley', price: 600 },
  { name: 'Ajmal Auram', price: 600 },
  { name: 'Naseem Burhan', price: 600 },
  { name: 'Naseem Muffadal', price: 600 },
  { name: 'Shy Oud', price: 1200 },
  { name: 'Cocoa Vanilla', price: 400 },
  { name: 'AOH BR540', price: 800 },
  { name: 'Aqua Di Geo', price: 600 },
  { name: 'Rassasi Ice', price: 800 },
  { name: 'Mukhallat Faris', price: 800 },
  { name: 'Oud Kalimat', price: 800 },
  { name: 'AOH Gulab', price: 400 },
  { name: 'AOH Mogra', price: 400 },
  { name: 'AOH Chandan', price: 400 },
  { name: 'Supreme Lux', price: 400 },
  { name: 'AOH Ponds', price: 400 },
  { name: 'Oud Agar', price: 600 },
  { name: 'Oud Amber', price: 600 },
  { name: 'AOH Kamal', price: 240 },
  { name: 'AOH Charli', price: 240 },
  { name: 'Raat Rani', price: 320 },
  { name: 'AOH Khus', price: 400 },
  { name: 'Black Oud', price: 400 },
  { name: 'AOH Magnet', price: 240 },
  { name: 'AOH Brute', price: 240 },
  { name: 'AOH Poision', price: 240 },
  { name: 'Musk Rizali', price: 1200 },
];

// ─── Firebase Storage REST API ────────────────────────────────────────────────
const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));

const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
});

async function getAccessToken() {
  const client = await auth.getClient();
  const res = await client.getAccessToken();
  return res.token;
}

async function uploadImage(localPath, destPath) {
  const token = await getAccessToken();
  const imageBytes = readFileSync(localPath);
  const encodedPath = encodeURIComponent(destPath);

  // Firebase Storage upload REST endpoint
  const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encodedPath}`;

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'image/png',
    },
    body: imageBytes,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Upload failed ${res.status}: ${txt}`);
  }

  const data = await res.json();
  // downloadTokens is set in the response; build the public download URL
  const downloadToken = data.downloadTokens;
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media&token=${downloadToken}`;
}

async function createFragrance(payload) {
  const res = await fetch(`${API_BASE}/fragrances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 Bulk Fragrance Import${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`   Processing indices ${START_INDEX}–${END_INDEX} of 70\n`);

  const results = { success: [], failed: [] };

  for (let i = START_INDEX; i <= Math.min(END_INDEX, 70); i++) {
    const frag   = FRAGRANCES[i - 1];
    const meta   = META[i - 1];
    const imgSrc = join(IMAGES_DIR, `${i}.png`);

    if (!existsSync(imgSrc)) {
      console.warn(`  ⚠️  [${i}] ${frag.name} — image not found at ${imgSrc}, skipping`);
      results.failed.push({ index: i, name: frag.name, error: 'image not found' });
      continue;
    }

    console.log(`  [${i}/70] ${frag.name} (₹${frag.price}/12ml)...`);

    try {
      const { ml12, ml6, ml3 } = sizePrices(frag.price);
      const slug = slugify(frag.name);

      // Upload image (shared by all sizes)
      let imageUrl = null;
      if (DRY_RUN) {
        imageUrl = `https://storage.googleapis.com/${BUCKET}/${STORAGE_FOLDER}/${slug}.png`;
        console.log(`    📸 [dry-run] Would upload → ${imageUrl}`);
      } else {
        const destPath = `${STORAGE_FOLDER}/${slug}.png`;
        imageUrl = await uploadImage(imgSrc, destPath);
        console.log(`    📸 Uploaded → ${imageUrl}`);
      }

      const webBase = {
        isPublished: true,
        slug,
        displayName: frag.name,
        shortDescription: `Available in 3ml (₹${ml3}), 6ml (₹${ml6}) & 12ml/1 Tola (₹${ml12}). ${meta.shortDesc}`,
        longDescription: meta.longDesc,
        images: [{ url: imageUrl, alt: frag.name, isPrimary: true, order: 0 }],
        tags: meta.tags,
        gender: meta.gender,
        fragranceFamily: meta.families,
        longevity: meta.longevity,
        publishedAt: new Date().toISOString(),
        seo: {
          title: `${frag.name} Attar — Pure Oil Perfume | Attarwala Optical House`,
          description: meta.shortDesc,
          keywords: [frag.name.toLowerCase(), 'attar', 'perfume oil', 'pure attar', ...meta.tags],
          ogImage: imageUrl,
        },
      };

      const payload = {
        type: 'attar',
        companyName: meta.companyName,
        name: frag.name,
        sellPrice: ml12,
        stock: 10,
        web: webBase,
      };

      if (DRY_RUN) {
        console.log(`    ✅ [dry-run] Would POST: ${JSON.stringify(payload, null, 2).slice(0, 200)}...`);
      } else {
        const saved = await createFragrance(payload);
        console.log(`    ✅ Created: ${saved._id}`);
      }

      results.success.push({ index: i, name: frag.name });
    } catch (err) {
      console.error(`    ❌ Failed: ${err.message}`);
      results.failed.push({ index: i, name: frag.name, error: err.message });
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`✅ Success: ${results.success.length}`);
  if (results.failed.length) {
    console.log(`❌ Failed:  ${results.failed.length}`);
    results.failed.forEach(f => console.log(`   - [${f.index}] ${f.name}: ${f.error}`));
  }
  console.log('─────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
