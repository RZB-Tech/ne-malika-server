-- Наполнение каталога. Маркетплейс только по компьютерной технике, поэтому
-- одежды/дома/продуктов здесь нет и не планируется.
--
-- Slug'и корней совпадают с прежним списком на клиенте: по ним подбирается
-- иконка, и менять их — значит терять картинки у существующих ссылок.
-- ON CONFLICT DO NOTHING делает вставку безопасной при повторном прогоне.

INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "icon", "position") VALUES
  (NULL, 'laptops',      'Ноутбуки',              'Noutbuklar',            'Ноутбуклар',            'Laptop',          10),
  (NULL, 'computers',    'Компьютеры',            'Kompyuterlar',          'Компьютерлар',          'PcCase',          20),
  (NULL, 'monitors',     'Мониторы',              'Monitorlar',            'Мониторлар',            'Monitor',         30),
  (NULL, 'videocards',   'Видеокарты',            'Videokartalar',         'Видеокарталар',         'CircuitBoard',    40),
  (NULL, 'cpu',          'Процессоры',            'Protsessorlar',         'Процессорлар',          'Cpu',             50),
  (NULL, 'motherboards', 'Материнские платы',     'Ona platalar',          'Она платалар',          'Server',          60),
  (NULL, 'ram',          'Оперативная память',    'Operativ xotira (RAM)', 'Оператив хотира (RAM)', 'MemoryStick',     70),
  (NULL, 'ssd',          'SSD',                   'SSD',                   'SSD',                   'HardDrive',       80),
  (NULL, 'hdd',          'HDD',                   'HDD',                   'HDD',                   'Database',        90),
  (NULL, 'psu',          'Блоки питания',         'Quvvat bloklari',       'Қувват блоклари',       'Power',          100),
  (NULL, 'cases',        'Корпуса',               'Korpuslar',             'Корпуслар',             'Box',            110),
  (NULL, 'cooling',      'Охлаждение',            'Sovutish tizimlari',    'Совутиш тизимлари',     'Fan',            120),
  (NULL, 'keyboards',    'Клавиатуры',            'Klaviaturalar',         'Клавиатуралар',         'Keyboard',       130),
  (NULL, 'mice',         'Мышки',                 'Sichqonchalar',         'Сичқончалар',           'Mouse',          140),
  (NULL, 'headphones',   'Наушники',              'Quloqchinlar',          'Қулоқчинлар',           'Headphones',     150),
  (NULL, 'audio',        'Аудио',                 'Audio texnika',         'Аудио техника',         'Speaker',        160),
  (NULL, 'webcams',      'Веб-камеры',            'Veb-kameralar',         'Веб-камералар',         'Webcam',         170),
  (NULL, 'printers',     'Принтеры и МФУ',        'Printer va MFQ',        'Принтер ва МФҚ',        'Printer',        180),
  (NULL, 'network',      'Сетевое оборудование',  'Tarmoq uskunalari',     'Тармоқ ускуналари',     'Wifi',           190),
  (NULL, 'ups',          'ИБП и стабилизаторы',   'UPS va stabilizatorlar','УПС ва стабилизаторлар','BatteryCharging',200),
  (NULL, 'servers',      'Серверное оборудование','Server uskunalari',     'Сервер ускуналари',     'HardDriveDownload', 210),
  (NULL, 'gaming',       'Игровые аксессуары',    'O‘yin aksessuarlari',   'Ўйин аксессуарлари',    'Gamepad2',       220),
  (NULL, 'tablets',      'Планшеты',              'Planshetlar',           'Планшетлар',            'Tablet',         230),
  (NULL, 'phones',       'Смартфоны',             'Smartfonlar',           'Смартфонлар',           'Smartphone',     240),
  (NULL, 'storage',      'Флешки и карты памяти', 'Flesh va xotira kartalari', 'Флеш ва хотира карталари', 'Usb',  250),
  (NULL, 'software',     'Программное обеспечение','Dasturiy ta’minot',    'Дастурий таъминот',     'Disc',           260),
  (NULL, 'furniture',    'Компьютерная мебель',   'Kompyuter mebeli',      'Компьютер мебели',      'Armchair',       270),
  (NULL, 'parts',        'Запчасти и кабели',     'Ehtiyot qismlar va kabellar', 'Эҳтиёт қисмлар ва кабеллар', 'Wrench', 280)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Подкатегории: родитель ищется по slug среди корней, поэтому порядок вставки
-- внутри файла значения не имеет, а slug листа уникален только внутри родителя.
INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "position")
SELECT parent.id, child.slug, child.ru, child.latn, child.cyrl, child.pos
FROM (VALUES
  ('laptops',      'gaming',        'Игровые',              'O‘yin uchun',           'Ўйин учун',             10),
  ('laptops',      'ultrabooks',    'Ультрабуки',           'Ultrabuklar',           'Ультрабуклар',          20),
  ('laptops',      'business',      'Для работы',           'Ish uchun',             'Иш учун',               30),
  ('laptops',      'budget',        'Бюджетные',            'Byudjet',               'Бюджет',                40),
  ('laptops',      'macbook',       'MacBook',              'MacBook',               'MacBook',               50),
  ('laptops',      'transformers',  'Трансформеры',         'Transformerlar',        'Трансформерлар',        60),

  ('computers',    'gaming-pc',     'Игровые ПК',           'O‘yin kompyuterlari',   'Ўйин компьютерлари',    10),
  ('computers',    'office-pc',     'Офисные ПК',           'Ofis kompyuterlari',    'Офис компьютерлари',    20),
  ('computers',    'workstations',  'Рабочие станции',      'Ishchi stansiyalar',    'Ишчи станциялар',       30),
  ('computers',    'mini-pc',       'Мини-ПК',              'Mini kompyuterlar',     'Мини компьютерлар',     40),
  ('computers',    'all-in-one',    'Моноблоки',            'Monobloklar',           'Моноблоклар',           50),

  ('monitors',     'gaming',        'Игровые',              'O‘yin uchun',           'Ўйин учун',             10),
  ('monitors',     'office',        'Офисные',              'Ofis uchun',            'Офис учун',             20),
  ('monitors',     'pro',           'Для дизайна',          'Dizayn uchun',          'Дизайн учун',           30),
  ('monitors',     'ultrawide',     'Ultrawide',            'Ultrawide',             'Ultrawide',             40),
  ('monitors',     'portable',      'Портативные',          'Portativ',              'Портатив',              50),

  ('videocards',   'nvidia',        'NVIDIA GeForce',       'NVIDIA GeForce',        'NVIDIA GeForce',        10),
  ('videocards',   'amd',           'AMD Radeon',           'AMD Radeon',            'AMD Radeon',            20),
  ('videocards',   'intel-arc',     'Intel Arc',            'Intel Arc',             'Intel Arc',             30),
  ('videocards',   'professional',  'Профессиональные',     'Professional',          'Профессионал',          40),

  ('cpu',          'intel',         'Intel',                'Intel',                 'Intel',                 10),
  ('cpu',          'amd',           'AMD',                  'AMD',                   'AMD',                   20),
  ('cpu',          'server-cpu',    'Серверные',            'Server uchun',          'Сервер учун',           30),

  ('motherboards', 'intel',         'Под Intel',            'Intel uchun',           'Intel учун',            10),
  ('motherboards', 'amd',           'Под AMD',              'AMD uchun',             'AMD учун',              20),
  ('motherboards', 'atx',           'ATX',                  'ATX',                   'ATX',                   30),
  ('motherboards', 'matx',          'Micro-ATX',            'Micro-ATX',             'Micro-ATX',             40),
  ('motherboards', 'mini-itx',      'Mini-ITX',             'Mini-ITX',              'Mini-ITX',              50),

  ('ram',          'ddr5',          'DDR5',                 'DDR5',                  'DDR5',                  10),
  ('ram',          'ddr4',          'DDR4',                 'DDR4',                  'DDR4',                  20),
  ('ram',          'ddr3',          'DDR3',                 'DDR3',                  'DDR3',                  30),
  ('ram',          'laptop-ram',    'Для ноутбуков (SO-DIMM)','Noutbuklar uchun',    'Ноутбуклар учун',       40),

  ('ssd',          'nvme',          'M.2 NVMe',             'M.2 NVMe',              'M.2 NVMe',              10),
  ('ssd',          'sata',          'SATA',                 'SATA',                  'SATA',                  20),
  ('ssd',          'external-ssd',  'Внешние',              'Tashqi',                'Ташқи',                 30),

  ('hdd',          'desktop',       'Для ПК',               'Kompyuter uchun',       'Компьютер учун',        10),
  ('hdd',          'nas',           'Для NAS',              'NAS uchun',             'NAS учун',              20),
  ('hdd',          'external-hdd',  'Внешние',              'Tashqi',                'Ташқи',                 30),

  ('psu',          'atx',           'ATX',                  'ATX',                   'ATX',                   10),
  ('psu',          'sfx',           'SFX',                  'SFX',                   'SFX',                   20),
  ('psu',          'modular',       'Модульные',            'Modulli',               'Модулли',               30),

  ('cases',        'midtower',      'Mid-Tower',            'Mid-Tower',             'Mid-Tower',             10),
  ('cases',        'fulltower',     'Full-Tower',           'Full-Tower',            'Full-Tower',            20),
  ('cases',        'mini',          'Mini-ITX',             'Mini-ITX',              'Mini-ITX',              30),

  ('cooling',      'air',           'Воздушное',            'Havoli sovutish',       'Ҳаволи совутиш',        10),
  ('cooling',      'liquid',        'Водяное',              'Suvli sovutish',        'Сувли совутиш',         20),
  ('cooling',      'fans',          'Вентиляторы',          'Ventilyatorlar',        'Вентиляторлар',         30),
  ('cooling',      'thermal-paste', 'Термопаста',           'Termopasta',            'Термопаста',            40),

  ('keyboards',    'mechanical',    'Механические',         'Mexanik',               'Механик',               10),
  ('keyboards',    'membrane',      'Мембранные',           'Membranali',            'Мембранали',            20),
  ('keyboards',    'wireless-kb',   'Беспроводные',         'Simsiz',                'Симсиз',                30),
  ('keyboards',    'gaming-kb',     'Игровые',              'O‘yin uchun',           'Ўйин учун',             40),

  ('mice',         'gaming',        'Игровые',              'O‘yin uchun',           'Ўйин учун',             10),
  ('mice',         'office',        'Офисные',              'Ofis uchun',            'Офис учун',             20),
  ('mice',         'wireless-mice', 'Беспроводные',         'Simsiz',                'Симсиз',                30),
  ('mice',         'pads',          'Коврики',              'Gilamchalar',           'Гиламчалар',            40),

  ('headphones',   'gaming',        'Игровые',              'O‘yin uchun',           'Ўйин учун',             10),
  ('headphones',   'wireless',      'Беспроводные',         'Simsiz',                'Симсиз',                20),
  ('headphones',   'wired',         'Проводные',            'Simli',                 'Симли',                 30),
  ('headphones',   'earbuds',       'Вкладыши (TWS)',       'TWS quloqchinlar',      'TWS қулоқчинлар',       40),

  ('audio',        'speakers',      'Колонки',              'Kolonkalar',            'Колонкалар',            10),
  ('audio',        'soundbars',     'Саундбары',            'Saundbarlar',           'Саундбарлар',           20),
  ('audio',        'microphones',   'Микрофоны',            'Mikrofonlar',           'Микрофонлар',           30),
  ('audio',        'soundcards',    'Звуковые карты',       'Ovoz kartalari',        'Овоз карталари',        40),

  ('webcams',      'fullhd',        'Full HD',              'Full HD',               'Full HD',               10),
  ('webcams',      '4k',            '4K',                   '4K',                    '4K',                    20),
  ('webcams',      'streaming',     'Для стриминга',        'Striming uchun',        'Стриминг учун',         30),

  ('printers',     'laser',         'Лазерные',             'Lazerli',               'Лазерли',               10),
  ('printers',     'inkjet',        'Струйные',             'Siyohli',               'Сиёҳли',                20),
  ('printers',     'mfp',           'МФУ',                  'MFQ',                   'МФҚ',                   30),
  ('printers',     'scanners',      'Сканеры',              'Skanerlar',             'Сканерлар',             40),
  ('printers',     'supplies',      'Картриджи и тонеры',   'Kartrij va tonerlar',   'Картриж ва тонерлар',   50),

  ('network',      'routers',       'Роутеры',              'Routerlar',             'Роутерлар',             10),
  ('network',      'switches',      'Коммутаторы',          'Kommutatorlar',         'Коммутаторлар',         20),
  ('network',      'access-points', 'Точки доступа',        'Kirish nuqtalari',      'Кириш нуқталари',       30),
  ('network',      'adapters',      'Сетевые адаптеры',     'Tarmoq adapterlari',    'Тармоқ адаптерлари',    40),
  ('network',      'net-cables',    'Сетевые кабели',       'Tarmoq kabellari',      'Тармоқ кабеллари',      50),

  ('ups',          'line-interactive','Линейно-интерактивные','Line-interactive',    'Line-interactive',      10),
  ('ups',          'online-ups',    'Онлайн (двойное преобразование)','Online',      'Онлайн',                20),
  ('ups',          'stabilizers',   'Стабилизаторы',        'Stabilizatorlar',       'Стабилизаторлар',       30),

  ('servers',      'rack',          'Серверы',              'Serverlar',             'Серверлар',             10),
  ('servers',      'server-parts',  'Комплектующие',        'Butlovchi qismlar',     'Бутловчи қисмлар',      20),
  ('servers',      'nas-devices',   'NAS-хранилища',        'NAS qurilmalari',       'NAS қурилмалари',       30),

  ('gaming',       'gamepads',      'Геймпады',             'Geympadlar',            'Геймпадлар',            10),
  ('gaming',       'chairs',        'Игровые кресла',       'O‘yin kreslolari',      'Ўйин креслолари',       20),
  ('gaming',       'wheels',        'Рули',                 'Rullar',                'Руллар',                30),
  ('gaming',       'vr',            'VR-гарнитуры',         'VR qurilmalar',         'VR қурилмалар',         40),
  ('gaming',       'consoles',      'Консоли',              'Konsollar',             'Консоллар',             50),

  ('tablets',      'android-tab',   'Android',              'Android',               'Android',               10),
  ('tablets',      'ipad',          'iPad',                 'iPad',                  'iPad',                  20),
  ('tablets',      'graphic-tab',   'Графические планшеты', 'Grafik planshetlar',    'График планшетлар',     30),
  ('tablets',      'ereaders',      'Электронные книги',    'Elektron kitoblar',     'Электрон китоблар',     40),

  ('phones',       'android-phone', 'Android',              'Android',               'Android',               10),
  ('phones',       'iphone',        'iPhone',               'iPhone',                'iPhone',                20),
  ('phones',       'phone-acc',     'Аксессуары',           'Aksessuarlar',          'Аксессуарлар',          30),
  ('phones',       'smartwatch',    'Смарт-часы',           'Smart soatlar',         'Смарт соатлар',         40),

  ('storage',      'flash',         'USB-флешки',           'USB flesh',             'USB флеш',              10),
  ('storage',      'sd',            'Карты памяти',         'Xotira kartalari',      'Хотира карталари',      20),
  ('storage',      'card-readers',  'Картридеры',           'Kartriderlar',          'Картридерлар',          30),

  ('software',     'os',            'Операционные системы', 'Operatsion tizimlar',   'Операцион тизимлар',    10),
  ('software',     'office-soft',   'Офисные пакеты',       'Ofis dasturlari',       'Офис дастурлари',       20),
  ('software',     'antivirus',     'Антивирусы',           'Antiviruslar',          'Антивируслар',          30),

  ('furniture',    'desks',         'Компьютерные столы',   'Kompyuter stollari',    'Компьютер столлари',    10),
  ('furniture',    'office-chairs', 'Офисные кресла',       'Ofis kreslolari',       'Офис креслолари',       20),
  ('furniture',    'mounts',        'Кронштейны и стойки',  'Kronshteyn va tayanchlar','Кронштейн ва таянчлар',30),

  ('parts',        'cables',        'Кабели и переходники', 'Kabel va o‘tkazgichlar','Кабель ва ўтказгичлар', 10),
  ('parts',        'batteries',     'Аккумуляторы',         'Akkumulyatorlar',       'Аккумуляторлар',        20),
  ('parts',        'chargers',      'Зарядные устройства',  'Quvvatlagichlar',       'Қувватлагичлар',        30),
  ('parts',        'screens',       'Матрицы и экраны',     'Matritsa va ekranlar',  'Матрица ва экранлар',   40),
  ('parts',        'laptop-parts',  'Запчасти для ноутбуков','Noutbuk ehtiyot qismlari','Ноутбук эҳтиёт қисмлари',50)
) AS child(parent_slug, slug, ru, latn, cyrl, pos)
JOIN "categories" parent ON parent."slug" = child.parent_slug AND parent."parent_id" IS NULL
ON CONFLICT DO NOTHING;
