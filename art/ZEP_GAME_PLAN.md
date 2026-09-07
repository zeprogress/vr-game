# ZEP GAME — PLAN.md

> Текущий статус: рабочий MVP VR MMORPG.
> Цель следующей стадии: превратить техническую демку в игру с понятным повторяемым gameplay loop, не переписывая уже работающие системы.

---

# 1. Текущее состояние

## Платформы

- VR — Meta Quest 2/3, WebXR
- Desktop — браузер, keyboard + mouse
- Mobile — браузер, touch

## Технологии

- TypeScript
- Babylon.js 7
- Vite
- Colyseus / Node.js
- production VPS
- серверная авторитетная логика

## Уже работает

- вход по нику;
- multiplayer;
- синхронизация игроков;
- интерполяция;
- серверный Mob AI;
- слизни / плевуны;
- серверная боёвка;
- HP / смерть / respawn;
- XP / уровни / характеристики;
- меч;
- лук;
- щит;
- посох / базовая магия;
- блок;
- loot;
- inventory;
- health potion;
- сохранение прогресса;
- voice chat;
- PvP по согласию;
- persistent world;
- day/night;
- boss;
- GLB asset pipeline.

Не переписывать эти системы без необходимости.

---

# 2. Главная цель ближайшей версии

## ZEP GAME 0.2

Игрок должен проходить понятный цикл:

```text
HUB
  ↓
подготовка
  ↓
оружие / тренировка
  ↓
выход в мир
  ↓
бой
  ↓
лут
  ↓
Dynamic Event
  ↓
более сложный бой
  ↓
редкая награда
  ↓
возвращение в HUB
  ↓
улучшение
  ↓
снова в мир
```

Главный критерий:

> Игрок должен хотеть повторить цикл без длинной цепочки обязательных квестов.

---

# 3. Архитектурное направление

Мир постепенно переходит от одной общей игровой комнаты к нескольким типам инстансов:

```text
WORLD
│
├── HubRoom
├── MeadowRoom
├── DungeonRoom
├── ArenaRoom
└── Camp / Guild instances
```

## Правила

- HUB — отдельный instance / room.
- MEADOW — отдельный боевой instance.
- DUNGEON — отдельный instance.
- Клиент использует общий gameplay/input/net слой.
- Общие числа и правила остаются в `src/shared/`.
- Не создавать новые независимые системы, если можно переиспользовать существующие.

---

# 4. Порядок развития

```text
12. HUB
        ↓
13. COMBAT 2.0
        ↓
14. DYNAMIC WORLD EVENTS
        ↓
15. DUNGEON
        ↓
16. LOOT / CRAFT / PROGRESSION 2.0
        ↓
17. SOCIAL / PARTY / TRADE
        ↓
18. CAMP / GUILD
        ↓
19. WORLD EXPANSION
        ↓
20. MMO SCALING
```

Приоритет определяется влиянием на gameplay loop, а не количеством контента.

---

# 5. Этап 12 — HUB

## Цель

Создать безопасный боевой лагерь, который является постоянным домом игрока.

## Архитектура

```text
HubRoom
```

Не использовать старую `ZoneRoom` как контейнер HUB.

## HUB содержит

- player spawn;
- central plaza;
- campfire;
- weapon area;
- training range;
- training dummies;
- target range;
- instructor NPC;
- market stalls;
- forge;
- main tent;
- watch tower;
- gate;
- path to Meadow.

## Главный маршрут

```text
Spawn
 ↓
Weapon Area
 ↓
Training
 ↓
Central Campfire
 ↓
Gate
 ↓
Path
 ↓
Meadow
```

## Safe Zone

В HUB:

- mob damage disabled;
- mob aggro disabled;
- PvP disabled.

Проверка safe zone — серверная.

## HUB v1

Сначала сделать blockout из Babylon primitives.

Не делать сразу финальные модели.

---

# 6. HUB — визуальная цель

Хаб должен выглядеть как небольшой боевой лагерь перед опасной дикой территорией.

Не город.

Материалы:

- wood;
- stone;
- canvas;
- rope;
- metal;
- dirt;
- grass.

Главный визуальный переход:

```text
HUB
clean / warm / safe
        ↓
gate
        ↓
path
        ↓
MEADOW
wild / dark / dangerous
```

---

# 7. Этап 13 — COMBAT 2.0

## Цель

Сделать бой интересным сам по себе.

Основной принцип:

> выбор оружия + позиционирование + реакция врага + правильный момент атаки.

## Оружие

### Sword + Shield

- ближний бой;
- block;
- frontline;
- stagger.

### Bow

- дальняя атака;
- точность;
- уязвимость в ближнем бою;
- headshot.

### Staff

- AoE;
- control;
- support;
- magic.

## Враги

Минимальный состав:

1. Basic
2. Swarm
3. Tank / Armored
4. Ranged
5. Elite

## Контр-система

```text
Swarm      → Sword / AoE
Tank       → Bow / positioning
Ranged     → close distance / cover
Basic      → любой стиль
Elite      → teamwork / mechanics
```

## Combat feedback

Добавить:

- hit flash;
- sound;
- stagger;
- knockback;
- attack telegraph;
- impact particles;
- block feedback;
- death feedback.

Не увеличивать сложность только за счёт цифр.

---

# 8. Этап 14 — DYNAMIC WORLD EVENTS

## Цель

Сделать мир живым.

Игрок должен иногда получать ощущение:

> «Прямо сейчас в мире происходит что-то важное».

## Event Manager

```text
IDLE
 ↓
EVENT SELECT
 ↓
EVENT ACTIVE
 ↓
EVENT RESOLVE
 ↓
REWARD
 ↓
COOLDOWN
```

## Первые события

### Monster Invasion

Несколько волн мобов.

### Meteor

На поле появляется редкий ресурс.

### Elite Hunt

Появляется редкий сильный моб.

### Camp Defense

Опасность направляется в сторону HUB.

### World Boss

Большое событие для нескольких игроков.

## Правила

События должны:

- появляться без ручного запуска;
- иметь таймер;
- показывать состояние игроку;
- собирать игроков в одной точке;
- давать награду;
- иметь cooldown;
- использовать существующие combat/loot.

Не создавать отдельный combat system.

---

# 9. Этап 15 — DUNGEON

## Цель

Первый полноценный кооперативный контент.

```text
HUB
 ↓
party 2–4
 ↓
Dungeon
 ↓
rooms
 ↓
combat
 ↓
traps
 ↓
elite
 ↓
boss
 ↓
loot
 ↓
HUB
```

## Архитектура

```text
DungeonRoom
```

## Первый dungeon

Не огромный.

```text
Entrance
 ↓
Room A
 ↓
Room B
 ├── trap
 └── enemy
 ↓
Room C
 ↓
Key
 ↓
Boss Room
```

Особенности:

- 2–4 игрока;
- teleport/comfort режим для VR;
- ключ;
- ловушки;
- элитный моб;
- финальный босс;
- редкий материал.

---

# 10. Этап 16 — LOOT 2.0

## Цель

Сделать лут причиной играть дальше.

## Тиры

```text
Common
Uncommon
Rare
Epic
Legendary
```

## Свойства

Предметы должны различаться механикой, а не только числом урона.

Пример:

```text
Fire Sword
+ fire damage

Hunter Bow
+ crit

Guardian Shield
+ block

Storm Staff
+ AoE
```

---

# 11. Этап 16 — CRAFT

Использовать существующую кузницу.

```text
Dungeon
 ↓
Materials
 ↓
HUB Forge
 ↓
Craft
 ↓
New Weapon
 ↓
Harder Content
```

Первая версия:

- 5–10 рецептов;
- sword;
- bow;
- shield;
- staff materials;
- редкие материалы;
- один сильный end-of-chain рецепт.

---

# 12. Этап 16 — PROGRESSION 2.0

Текущие:

- XP;
- level;
- stats

остаются.

Добавляется:

## Weapon Mastery

```text
Sword Mastery
Bow Mastery
Staff Mastery
```

Mastery должна открывать новые возможности, а не только увеличивать цифры.

Пример:

```text
Lv 1 — basic
Lv 5 — parry
Lv 10 — counter
Lv 20 — special ability
```

---

# 13. Роли персонажа

Не делать жёсткие MMO-классы.

Использовать гибкую систему:

```text
Strength
Dexterity
Intelligence
```

Возможные роли:

- Tank;
- Warrior;
- Archer;
- Mage;
- Support;
- Hybrid.

Игрок может менять стиль через оружие и билд.

---

# 14. Этап 17 — SOCIAL

Только после появления хорошего совместного gameplay.

Добавить:

- Party;
- Friends;
- Trade;
- social emotes;
- shared objectives;
- leaderboard;
- voice proximity.

Использовать уже существующий voice chat.

---

# 15. Этап 18 — CAMP / GUILD

## Личный / групповой лагерь

Игроки получают:

- campfire;
- storage;
- forge;
- respawn banner;
- wardstone;
- decorations.

## Строительство

Первая версия:

```text
Foundation
Wall
Floor
Campfire
Chest
Forge
Banner
Torch
```

Позже:

- snap grid;
- doors;
- roofs;
- defenses;
- decorations.

## Guild

```text
Player
 ↓
Party
 ↓
Camp
 ↓
Guild
 ↓
Guild Camp
 ↓
Territory
```

Первая версия:

- создание guild;
- приглашение;
- members;
- shared storage;
- guild camp;
- guild name/banner.

---

# 16. Этап 19 — WORLD EXPANSION

Новые зоны добавляются только вместе с новой причиной играть.

Пример:

```text
Forest
→ ambush mechanics

Ruins
→ traps / undead

Mountains
→ vertical traversal

Swamp
→ poison / slow

Volcanic zone
→ heat / fire mechanics
```

Не делать новые карты только ради размера мира.

---

# 17. Этап 20 — MMO SCALING

Только после подтверждения gameplay loop.

Пример:

```text
Gateway
   │
   ├── Hub-01
   ├── Hub-02
   ├── Meadow-01
   ├── Meadow-02
   ├── Dungeon-17
   └── Arena-03
```

Позже:

- PostgreSQL;
- Redis;
- multiple zone servers;
- monitoring;
- server metrics.

Не оптимизировать преждевременно.

---

# 18. Что НЕ делать сейчас

До завершения ZEP GAME 0.2 не начинать:

- огромный seamless world;
- сотни квестов;
- десятки классов;
- сложную экономику;
- auction house;
- housing system;
- guild warfare;
- 20+ видов оружия;
- сотни мобов;
- сложный skill tree.

---

# 19. Gameplay-first приоритет

Проверка каждой новой системы:

```text
1. Делает ли это игру веселее?
2. Создаёт ли это новое решение для игрока?
3. Заставляет ли это вернуться?
4. Создаёт ли это взаимодействие игроков?
5. Можно ли переиспользовать существующую систему?
6. Сколько контента нужно поддерживать после реализации?
```

Если система добавляет только контент, но не добавляет новый gameplay loop — откладывать.

---

# 20. Performance rules

Quest 2/3 остаются главным target.

Цель:

- простая геометрия;
- low draw calls;
- instancing;
- простые материалы;
- минимум dynamic lights;
- минимум прозрачных эффектов;
- lazy loading ассетов;
- GLB cache.

Не строить тяжёлый мир вокруг PC-only возможностей.

---

# 21. Definition of Done — ZEP GAME 0.2

Версия считается готовой, когда новый игрок может:

```text
1. Войти в HUB
2. Понять, что делать
3. Взять оружие
4. Потренироваться
5. Выйти через ворота
6. Сразиться с разными врагами
7. Получить loot
8. Увидеть Dynamic Event
9. Участвовать в событии
10. Получить редкую награду
11. Вернуться в HUB
12. Улучшить снаряжение
13. Снова отправиться в мир
```

Главный критерий: игрок хочет пройти этот цикл второй раз.

---

# 22. Следующая задача

## NOW — Этап 12.1

Создать:

```text
HubRoom
```

и подключить:

```text
HubRoom
 ├── player spawn
 ├── movement
 ├── multiplayer
 └── empty scene
```

## 12.2

Создать blockout:

```text
ground
central plaza
campfire area
weapon area
training area
gate
path
```

## 12.3

Подключить:

```text
Hub safe zone
Hub → Meadow
Meadow → Hub
```

Только после этого переходить к визуальному оформлению.

---

# 23. Правило разработки

Каждый этап:

```text
PLAN
 ↓
IMPLEMENT
 ↓
TYPECHECK
 ↓
BUILD
 ↓
PLAYTEST
 ↓
FIX
 ↓
NEXT
```

Не делать сразу несколько крупных gameplay-систем.

Каждый законченный этап должен оставлять игру рабочей.

---

# 24. Текущий приоритет

```text
████████████████████████████ HUB
████████████████████████████ COMBAT 2.0
████████████████████████ DYNAMIC EVENTS
████████████████████ DUNGEON
████████████████ LOOT / CRAFT
████████████ SOCIAL
████████ CAMP / GUILD
████ WORLD
```

# BUILD THE HUB
