-- Campus gallery: first real photo supplied by the school. The image file ships
-- with the website (public/gallery/), so it shows before any upload is made.
-- Title, album and date can be edited, or the photo removed, in Admin → Gallery.
insert into public.gallery_items (id, title_en, title_bn, image_path, album, sort_order, status)
values (
  md5('kiisc:gallery:campus-event-2026')::uuid,
  'Students, teachers and guests at a campus programme',
  'ক্যাম্পাসের একটি অনুষ্ঠানে শিক্ষার্থী, শিক্ষক ও অতিথিবৃন্দ',
  '/gallery/campus-event-2026.jpg',
  'Campus',
  0,
  'published'
)
on conflict (id) do nothing;
