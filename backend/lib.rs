use candid::{CandidType, Principal, Deserialize, encode_one, decode_one};
use ic_cdk::{update, query};
use ic_cdk::api::caller; // совместимо с ic-cdk 0.18.x

use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, BTreeMap as StableBTreeMap, Cell,
};
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct Event {
    pub id: u64,
    pub title: String,
    pub date: String,      // YYYY-MM-DD
    pub time: String,      // HH:mm
    pub city: String,
    pub category: String,
    pub venue: String,
    pub image: String,
    pub description: String,
    pub price_uah: u64,    // цена в гривне
    pub price_e8s: u64,    // цена в ICP (e8s)
    #[serde(default)]
    pub created_by: Option<Principal>,  // кто создал (None у «посевных»)
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct NewEvent {
    pub title: String,
    pub date: String,
    pub time: String,
    pub city: String,
    pub category: String,
    pub venue: String,
    pub image: String,
    pub description: String,
    pub price_uah: u64,
    pub price_e8s: u64,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct Ticket {
    pub id: String,
    pub event_id: u64,
    pub title: String,
    pub date: String,
    pub time: String,
    pub city: String,
    pub venue: String,
    pub category: String,
    pub price_uah: u64,
    pub price_e8s: u64,
    pub qr_code: String, // JSON строка с полезными полями
}

thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static GREETING: RefCell<Cell<String, Memory>> = RefCell::new(
        Cell::init(
            MM.with(|m| m.borrow().get(MemoryId::new(0))),
            "Hello, ".to_string()
        ).unwrap()
    );

    // Principal -> Vec<u8> (Candid-кодированный Vec<Ticket>)
    static TICKETS: RefCell<StableBTreeMap<Principal, Vec<u8>, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MM.with(|m| m.borrow().get(MemoryId::new(1)))
        )
    );

    // Events: id (u64) -> Event (как Vec<u8>)
    static EVENTS: RefCell<StableBTreeMap<u64, Vec<u8>, Memory>> = RefCell::new(
        StableBTreeMap::init(
            MM.with(|m| m.borrow().get(MemoryId::new(2)))
        )
    );

    // NEXT_EVENT_ID counter
    static NEXT_EVENT_ID: RefCell<Cell<u64, Memory>> = RefCell::new(
        Cell::init(
            MM.with(|m| m.borrow().get(MemoryId::new(3))),
            1_u64
        ).unwrap()
    );

    // Флаг «каталог засеян»
    static SEEDED: RefCell<Cell<u8, Memory>> = RefCell::new(
        Cell::init(
            MM.with(|m| m.borrow().get(MemoryId::new(4))),
            0_u8
        ).unwrap()
    );
}

// ---- helpers ----

fn read_user_tickets(user: Principal) -> Vec<Ticket> {
    TICKETS.with(|map| {
        let map = map.borrow();
        match map.get(&user) {
            Some(bytes) => decode_one::<Vec<Ticket>>(&bytes).unwrap_or_default(),
            None => Vec::new(),
        }
    })
}

fn write_user_tickets(user: Principal, tickets: &Vec<Ticket>) {
    let bytes = encode_one(tickets).expect("encode tickets");
    TICKETS.with(|map| {
        map.borrow_mut().insert(user, bytes);
    });
}

fn put_event(ev: &Event) {
    EVENTS.with(|m| {
        let bytes = encode_one(ev).expect("encode event");
        m.borrow_mut().insert(ev.id, bytes);
    });
}

fn get_event(id: u64) -> Option<Event> {
    EVENTS.with(|m| {
        m.borrow().get(&id).and_then(|bytes| decode_one::<Event>(&bytes).ok())
    })
}

fn get_all_events() -> Vec<Event> {
    let mut out = Vec::new();
    EVENTS.with(|m| {
        for (_, v) in m.borrow().iter() {
            if let Ok(ev) = decode_one::<Event>(&v) {
                out.push(ev);
            }
        }
    });
    out.sort_by_key(|e| e.id);
    out
}

fn seed_events_once() {
    let seeded: u8 = SEEDED.with(|c| *c.borrow().get());
    if seeded != 0 { return; }

    let seed = vec![
        NewEvent {
            title: "N Crypto Awards 2025".into(),
            date: "2025-10-12".into(),
            time: "12:00".into(),
            city: "Kyiv".into(),
            category: "Comedy".into(),
            venue: "Parkova road, 16a, Kiev, 03150".into(),
            image: "https://d2q8nf5aywi2aj.cloudfront.net/uploads/resize/shows/logo/630x891_1751027556.webp".into(),
            description: "Main final event of the year in crypto/Web3 in Ukraine".into(),
            price_uah: 1800,
            price_e8s: 200_000_000, // 2.00 ICP
        },
        NewEvent {
            title: "E-Commerce Conference 2025".into(),
            date: "2025-10-13".into(),
            time: "12:00".into(),
            city: "Kyiv".into(),
            category: "Theater".into(),
            venue: "Parkova road, 16a, Kiev, 03150".into(),
            image: "https://d2q8nf5aywi2aj.cloudfront.net/uploads/resize/shows/logo/630x891_1755874606.webp".into(),
            description: "Largest professional event in Ukraine dedicated to e-commerce.".into(),
            price_uah: 1500,
            price_e8s: 150_000_000, // 1.5 ICP
        },
        NewEvent {
            title: "MUSIC BOX FEST".into(),
            date: "2025-06-21".into(),
            time: "12:00".into(),
            city: "Kyiv".into(),
            category: "Concert".into(),
            venue: "st. Glushkova, 9".into(),
            image: "https://images.karabas.com/external/018e50bb-71e5-7428-9b44-4f503fcfd169/events/01968fb9-7033-7bda-b177-10c68a8492b0/2565465959_ImageBig638853480874554690_700_1000.webp?v=1".into(),
            description: "Biggest music festival in the capital with 20 stars.".into(),
            price_uah: 400,
            price_e8s: 50_000_000, // 0.5 ICP
        },
    ];

    for ne in seed {
        let id: u64 = NEXT_EVENT_ID.with(|c| {
            let cur = *c.borrow().get();
            c.borrow_mut().set(cur + 1).unwrap();
            cur
        });

        let ev = Event {
            id,
            title: ne.title,
            date: ne.date,
            time: ne.time,
            city: ne.city,
            category: ne.category,
            venue: ne.venue,
            image: ne.image,
            description: ne.description,
            price_uah: ne.price_uah,
            price_e8s: ne.price_e8s,
            created_by: None, // «посевные» без владельца — редактировать сможет любой
        };
        put_event(&ev);
    }

    SEEDED.with(|c| c.borrow_mut().set(1).unwrap());
}

// ---- public methods ----

#[query]
fn get_events() -> Vec<Event> {
    seed_events_once();
    get_all_events()
}

#[update]
fn create_event_pwd(password: String, new_event: NewEvent) -> Result<Event, String> {
    // Простой пароль на уровне канистры (для хакатона ок; в проде — заменить на ролевую модель).
    if password != "1298" {
        return Err("Invalid password".into());
    }
    let me = caller();

    let id: u64 = NEXT_EVENT_ID.with(|c| {
        let cur = *c.borrow().get();
        c.borrow_mut().set(cur + 1).unwrap();
        cur
    });

    let ev = Event {
        id,
        title: new_event.title,
        date: new_event.date,
        time: new_event.time,
        city: new_event.city,
        category: new_event.category,
        venue: new_event.venue,
        image: new_event.image,
        description: new_event.description,
        price_uah: new_event.price_uah,
        price_e8s: new_event.price_e8s,
        created_by: Some(me),
    };
    put_event(&ev);
    Ok(ev)
}

#[update]
fn update_event(id: u64, data: NewEvent) -> Result<Event, String> {
    let me = caller();
    let mut ev = get_event(id).ok_or_else(|| "Event not found".to_string())?;

    if let Some(owner) = ev.created_by {
        if owner != me {
            return Err("Only the creator can edit this event.".into());
        }
    }

    ev.title = data.title;
    ev.date = data.date;
    ev.time = data.time;
    ev.city = data.city;
    ev.category = data.category;
    ev.venue = data.venue;
    ev.image = data.image;
    ev.description = data.description;
    ev.price_uah = data.price_uah;
    ev.price_e8s = data.price_e8s;

    put_event(&ev);
    Ok(ev)
}

#[update]
fn delete_event(id: u64) -> Result<(), String> {
    let me = caller();
    let ev = get_event(id).ok_or_else(|| "Event not found".to_string())?;
    if let Some(owner) = ev.created_by {
        if owner != me {
            return Err("Only the creator can delete this event.".into());
        }
    }
    EVENTS.with(|m| { m.borrow_mut().remove(&id); });
    Ok(())
}

#[update]
fn buy_ticket(event_id: u64) -> Result<Ticket, String> {
    let me = caller();
    if me == Principal::anonymous() {
        return Err("Please sign in with Internet Identity or connect Plug to buy.".into());
    }

    let ev = get_event(event_id).ok_or_else(|| "Event not found".to_string())?;

    let now = ic_cdk::api::time(); // ns
    let qr_payload = format!(
        r#"{{"ticket":"{}-{}","event_id":{},"title":"{}","principal":"{}","ts":{}}}"#,
        ev.id, now, ev.id, ev.title, me.to_text(), now
    );

    let ticket = Ticket {
        id: format!("{}-{}", ev.id, now),
        event_id: ev.id,
        title: ev.title.clone(),
        date: ev.date.clone(),
        time: ev.time.clone(),
        city: ev.city.clone(),
        venue: ev.venue.clone(),
        category: ev.category.clone(),
        price_uah: ev.price_uah,
        price_e8s: ev.price_e8s,
        qr_code: qr_payload,
    };

    let mut list = read_user_tickets(me);
    list.push(ticket.clone());
    write_user_tickets(me, &list);

    Ok(ticket)
}

#[update]
fn delete_ticket(ticket_id: String) -> Result<(), String> {
    let me = caller();
    let mut list = read_user_tickets(me);
    let before = list.len();
    list.retain(|t| t.id != ticket_id);
    if list.len() == before {
        return Err("Ticket not found".into());
    }
    write_user_tickets(me, &list);
    Ok(())
}

#[query]
fn get_my_tickets() -> Vec<Ticket> {
    let me = caller();
    read_user_tickets(me)
}

// ---- demo from template ----

#[update]
fn set_greeting(prefix: String) {
    GREETING.with(|c| c.borrow_mut().set(prefix).unwrap());
}

#[query]
fn greet(name: String) -> String {
    GREETING.with(|c| format!("{}{}!", c.borrow().get(), name))
}

ic_cdk::export_candid!();
