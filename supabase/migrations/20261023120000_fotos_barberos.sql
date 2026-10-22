-- Fotos propias de los barberos (archivos en assets/imagenes/barberos).
-- Solo reemplaza fotos vacías o de stock: no pisa una foto subida desde el panel.
update public.barberos b
   set foto_url = f.foto
  from (values ('Isaac Garcia', 'assets/imagenes/barberos/isaac-garcia.webp'),
               ('Yadfreidel Victoria', 'assets/imagenes/barberos/yadfreidel-victoria.webp'),
               ('Acxel Rosario', 'assets/imagenes/barberos/acxel-rosario.webp')) as f (nombre, foto)
 where b.nombre = f.nombre
   and (b.foto_url is null or b.foto_url = '' or b.foto_url like 'https://images.unsplash.com/%');
