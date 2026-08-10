-- Расширение каталога: больше вариантов внутри существующих разделов.
-- Отдельной миграцией, а не правкой 0012: та уже применена на стендах, и
-- переписывать применённый файл — значит разъехаться с их состоянием.
-- Родитель ищется по slug среди корней, ON CONFLICT DO NOTHING делает прогон
-- безопасным при повторе.

INSERT INTO "categories" ("parent_id", "slug", "name_ru", "name_uz_latn", "name_uz_cyrl", "position")
SELECT parent.id, child.slug, child.ru, child.latn, child.cyrl, child.pos
FROM (VALUES
  ('laptops',      'workstation-nb', 'Мобильные рабочие станции','Mobil ishchi stansiyalar','Мобил ишчи станциялар', 70),
  ('laptops',      'chromebook',     'Хромбуки',             'Xrombuklar',            'Хромбуклар',            80),
  ('laptops',      'refurbished',    'Восстановленные',      'Tiklangan',             'Тикланган',             90),

  ('computers',    'barebone',       'Барбоны',              'Barebone',              'Барбон',                60),
  ('computers',    'thin-client',    'Тонкие клиенты',       'Yupqa mijozlar',        'Юпқа мижозлар',         70),
  ('computers',    'mac',            'Apple Mac',            'Apple Mac',             'Apple Mac',             80),

  ('monitors',     'curved',         'Изогнутые',            'Egri ekranli',          'Эгри экранли',          60),
  ('monitors',     'ips',            'IPS',                  'IPS',                   'IPS',                   70),
  ('monitors',     'oled',           'OLED',                 'OLED',                  'OLED',                  80),
  ('monitors',     '4k-monitor',     '4K и выше',            '4K va undan yuqori',    '4K ва ундан юқори',     90),
  ('monitors',     'touch',          'Сенсорные',            'Sensorli',              'Сенсорли',             100),

  ('videocards',   'workstation-gpu','Для рабочих станций',  'Ishchi stansiyalar uchun','Ишчи станциялар учун',50),
  ('videocards',   'external-gpu',   'Внешние (eGPU)',       'Tashqi (eGPU)',         'Ташқи (eGPU)',          60),
  ('videocards',   'used-gpu',       'Б/у видеокарты',       'Ishlatilgan videokartalar','Ишлатилган видеокарталар',70),

  ('cpu',          'boxed',          'BOX (с кулером)',      'BOX (kuler bilan)',     'BOX (кулер билан)',     40),
  ('cpu',          'tray',           'OEM (без кулера)',     'OEM (kulersiz)',        'OEM (кулерсиз)',        50),
  ('cpu',          'laptop-cpu',     'Для ноутбуков',        'Noutbuklar uchun',      'Ноутбуклар учун',       60),

  ('motherboards', 'server-mb',      'Серверные',            'Server uchun',          'Сервер учун',           60),
  ('motherboards', 'ddr5-mb',        'С поддержкой DDR5',    'DDR5 qo‘llab-quvvatlash','DDR5 қўллаб-қувватлаш',70),
  ('motherboards', 'wifi-mb',        'Со встроенным Wi-Fi',  'O‘rnatilgan Wi-Fi bilan','Ўрнатилган Wi-Fi билан',80),

  ('ram',          'ecc',            'Серверная ECC',        'Server ECC',            'Сервер ECC',            50),
  ('ram',          'rgb-ram',        'С подсветкой RGB',     'RGB yoritgichli',       'RGB ёритгичли',         60),
  ('ram',          'kits',           'Комплекты (2×, 4×)',   'To‘plamlar (2×, 4×)',   'Тўпламлар (2×, 4×)',    70),

  ('ssd',          'm2-sata',        'M.2 SATA',             'M.2 SATA',              'M.2 SATA',              40),
  ('ssd',          'u2',             'U.2 и серверные',      'U.2 va server uchun',   'U.2 ва сервер учун',    50),
  ('ssd',          'pcie5',          'PCIe 5.0',             'PCIe 5.0',              'PCIe 5.0',              60),

  ('hdd',          'surveillance',   'Для видеонаблюдения',  'Videokuzatuv uchun',    'Видеокузатув учун',     40),
  ('hdd',          'laptop-hdd',     'Для ноутбуков 2.5"',   'Noutbuklar uchun 2.5"', 'Ноутбуклар учун 2.5"',  50),

  ('psu',          'bronze',         '80 PLUS Bronze',       '80 PLUS Bronze',        '80 PLUS Bronze',        40),
  ('psu',          'gold',           '80 PLUS Gold',         '80 PLUS Gold',          '80 PLUS Gold',          50),
  ('psu',          'platinum',       '80 PLUS Platinum',     '80 PLUS Platinum',      '80 PLUS Platinum',      60),

  ('cases',        'rgb-case',       'С подсветкой',         'Yoritgichli',           'Ёритгичли',             40),
  ('cases',        'silent-case',    'Тихие',                'Shovqinsiz',            'Шовқинсиз',             50),
  ('cases',        'glass-case',     'Со стеклом',           'Shishali',              'Шишали',                60),

  ('cooling',      'aio',            'Готовые СЖО',          'Tayyor suvli tizimlar', 'Тайёр сувли тизимлар',  50),
  ('cooling',      'laptop-cooling', 'Подставки для ноутбуков','Noutbuk tagliklari',  'Ноутбук тагликлари',    60),
  ('cooling',      'thermal-pads',   'Термопрокладки',       'Termoprokladkalar',     'Термопрокладкалар',     70),

  ('keyboards',    'compact-kb',     'Компактные (60/65%)',  'Ixcham (60/65%)',       'Ихчам (60/65%)',        50),
  ('keyboards',    'full-kb',        'Полноразмерные',       'To‘liq o‘lchamli',      'Тўлиқ ўлчамли',         60),
  ('keyboards',    'ergonomic-kb',   'Эргономичные',         'Ergonomik',             'Эргономик',             70),
  ('keyboards',    'kb-accessories', 'Кейкапы и свитчи',     'Keykap va svitchlar',   'Кейкап ва свитчлар',    80),

  ('mice',         'vertical-mice',  'Вертикальные',         'Vertikal',              'Вертикал',              50),
  ('mice',         'lightweight',    'Лёгкие для игр',       'Yengil o‘yin uchun',    'Енгил ўйин учун',       60),
  ('mice',         'trackball',      'Трекболы',             'Trekbollar',            'Трекболлар',            70),

  ('headphones',   'anc',            'С шумоподавлением',    'Shovqin bostirishli',   'Шовқин бостиришли',     50),
  ('headphones',   'studio',         'Студийные',            'Studiya uchun',         'Студия учун',           60),
  ('headphones',   'headsets',       'Гарнитуры с микрофоном','Mikrofonli garnituralar','Микрофонли гарнитуралар',70),

  ('audio',        'amplifiers',     'Усилители и ЦАП',      'Kuchaytirgich va DAC',  'Кучайтиргич ва DAC',    50),
  ('audio',        'studio-monitors','Студийные мониторы',   'Studiya monitorlari',   'Студия мониторлари',    60),
  ('audio',        'audio-cables',   'Аудиокабели',          'Audio kabellar',        'Аудио кабеллар',        70),

  ('webcams',      'conference',     'Для конференций',      'Konferensiya uchun',    'Конференция учун',      40),
  ('webcams',      'ip-cameras',     'IP-камеры',            'IP kameralar',          'IP камералар',          50),

  ('printers',     'plotters',       'Плоттеры',             'Plotterlar',            'Плоттерлар',            60),
  ('printers',     'label-printers', 'Принтеры этикеток',    'Yorliq printerlari',    'Ёрлиқ принтерлари',     70),
  ('printers',     'paper',          'Бумага и носители',    'Qog‘oz va tashuvchilar','Қоғоз ва ташувчилар',   80),

  ('network',      'modems',         'Модемы 4G/5G',         '4G/5G modemlar',        '4G/5G модемлар',        60),
  ('network',      'mesh',           'Mesh-системы',         'Mesh tizimlar',         'Mesh тизимлар',         70),
  ('network',      'racks',          'Шкафы и патч-панели',  'Shkaf va patch-panellar','Шкаф ва патч-панеллар',80),
  ('network',      'poe',            'PoE-оборудование',     'PoE uskunalari',        'PoE ускуналари',        90),

  ('ups',          'ups-batteries',  'Аккумуляторы для ИБП', 'UPS akkumulyatorlari',  'УПС аккумуляторлари',   40),
  ('ups',          'surge',          'Сетевые фильтры',      'Tarmoq filtrlari',      'Тармоқ филтрлари',      50),

  ('servers',      'server-cpu-parts','Серверные процессоры','Server protsessorlari', 'Сервер процессорлари',  40),
  ('servers',      'raid',           'RAID-контроллеры',     'RAID kontrollerlar',    'RAID контроллерлар',    50),
  ('servers',      'kvm',            'KVM-переключатели',    'KVM o‘tkazgichlar',     'KVM ўтказгичлар',       60),

  ('gaming',       'streaming-gear', 'Оборудование для стрима','Striming uskunalari', 'Стриминг ускуналари',   60),
  ('gaming',       'gaming-desks',   'Игровые столы',        'O‘yin stollari',        'Ўйин столлари',         70),
  ('gaming',       'arcade',         'Аркадные контроллеры', 'Arkada kontrollerlari', 'Аркада контроллерлари', 80),

  ('tablets',      'tab-accessories','Аксессуары для планшетов','Planshet aksessuarlari','Планшет аксессуарлари',50),
  ('tablets',      'styluses',       'Стилусы',              'Styluslar',             'Стилуслар',             60),

  ('phones',       'phone-cases',    'Чехлы',                'G‘iloflar',             'Ғилофлар',              50),
  ('phones',       'powerbanks',     'Внешние аккумуляторы', 'Powerbanklar',          'Пауэрбанклар',          60),
  ('phones',       'phone-glass',    'Защитные стёкла',      'Himoya shishalari',     'Ҳимоя шишалари',        70),

  ('storage',      'external-drives','Внешние накопители',   'Tashqi disklar',        'Ташқи дисклар',         40),
  ('storage',      'optical',        'Оптические приводы',   'Optik disklar',         'Оптик дисклар',         50),
  ('storage',      'docking',        'Док-станции для дисков','Disk dok-stansiyalari','Диск док-станциялари',  60),

  ('software',     'graphics-soft',  'Графика и дизайн',     'Grafika va dizayn',     'График ва дизайн',      40),
  ('software',     'games',          'Игры и подписки',      'O‘yin va obunalar',     'Ўйин ва обуналар',      50),
  ('software',     'dev-tools',      'Для разработчиков',    'Dasturchilar uchun',    'Дастурчилар учун',      60),

  ('furniture',    'gaming-desks-f', 'Геймерские столы',     'Geymer stollari',       'Геймер столлари',       40),
  ('furniture',    'standing-desks', 'Столы с регулировкой', 'Balandligi rostlanadigan stollar','Баландлиги ростланадиган столлар',50),
  ('furniture',    'cable-mgmt',     'Органайзеры для кабелей','Kabel organayzerlari','Кабель органайзерлари', 60),

  ('parts',        'cooling-parts',  'Кулеры и вентиляторы', 'Kuler va ventilyatorlar','Кулер ва вентиляторлар',60),
  ('parts',        'adapters',       'Переходники и хабы',   'O‘tkazgich va xablar',  'Ўтказгич ва хаблар',    70),
  ('parts',        'keyboards-parts','Клавиатуры для ноутбуков','Noutbuk klaviaturalari','Ноутбук клавиатуралари',80),
  ('parts',        'tools',          'Инструменты для ремонта','Ta’mirlash asboblari','Таъмирлаш асбоблари',   90)
) AS child(parent_slug, slug, ru, latn, cyrl, pos)
JOIN "categories" parent ON parent."slug" = child.parent_slug AND parent."parent_id" IS NULL
ON CONFLICT DO NOTHING;
