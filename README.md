# Ishlar — Asana uslubidagi vazifalar boshqaruvi

- Frontend: static HTML/JS (`public/`), build yo'q
- Backend: Supabase (`vazifa-board` loyihasi ichida, `ish_*` jadvallar — Topshiriq AI jadvallariga tegmaydi)
- Login: Google (Topshiriq AI bilan bir xil OAuth client)

## Imkoniyatlar
- Chap menyu: Bosh sahifa, Mening vazifalarim, Kiruvchi (bildirishnomalar), Loyihalar
- Loyiha ko'rinishlari: Ro'yxat (bo'limlar, sudrab tartiblash), Doska, Kalendar
- Vazifa paneli: bajarildi, mas'ul, muddat, bo'lim, muhimlik, tavsif, kichik vazifalar, izohlar va faoliyat tarixi
- Qidiruv, loyiha a'zolari (email orqali), real-time yangilanish

## Ma'lumotlar modeli
`ish_projects` · `ish_members (owner|member)` · `ish_sections` · `ish_tasks (parent_id = kichik vazifa)` · `ish_comments (comment|activity)` · `ish_inbox`
Ruxsatlar RLS orqali; faoliyat va bildirishnomalarni faqat DB triggerlari yozadi.

## Deploy
Static hosting: chiqish papkasi `public`. Sayt manzilini Google Cloud → OAuth client "Vazifa Board Web" → Authorized JavaScript origins ga qo'shing.
