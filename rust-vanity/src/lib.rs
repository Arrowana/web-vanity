use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);

    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[wasm_bindgen]
pub fn init_panic_hook() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

const ALPHANUMERIC_CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789";

fn generate_seed_from_counter(counter: u64) -> [u8; 16] {
    let mut seed = [0u8; 16];

    // Use counter and hash to generate indices into valid chars - much faster than base conversion
    let mut state1 = counter;
    let mut state2 = counter.wrapping_mul(0x9E3779B97F4A7C15); // Golden ratio hash

    for i in 0..8 {
        seed[i] = ALPHANUMERIC_CHARS[state1 as usize % ALPHANUMERIC_CHARS.len()];
        seed[i + 8] = ALPHANUMERIC_CHARS[state2 as usize % ALPHANUMERIC_CHARS.len()];
        state1 >>= 8;
        state2 >>= 8;
    }

    seed
}

fn maybe_bs58_aware_lowercase(pubkey: &str, case_insensitive: bool) -> String {
    if case_insensitive {
        pubkey.to_lowercase()
    } else {
        pubkey.to_string()
    }
}

fn check_prefix_match(encoded: &str, prefix_bytes: &[u8]) -> bool {
    let encoded_bytes = encoded.as_bytes();
    if encoded_bytes.len() < prefix_bytes.len() {
        return false;
    }

    for i in 0..prefix_bytes.len() {
        if encoded_bytes[i] != prefix_bytes[i] {
            return false;
        }
    }

    true
}

#[derive(Clone)]
enum MatchType {
    Prefix(String),
    Suffix(String),
    Both(String, String),
}

#[wasm_bindgen]
pub struct VanitySearcher {
    base_pubkey: [u8; 32],
    owner_pubkey: [u8; 32],
    match_type: MatchType,
    case_insensitive: bool,
    count: u64,
    count_offset: u64,
    should_exit: bool,
}

#[wasm_bindgen]
impl VanitySearcher {
    #[wasm_bindgen(constructor)]
    pub fn new(
        base_pubkey: &[u8],
        owner_pubkey: &[u8],
        prefix: Option<String>,
        suffix: Option<String>,
        case_insensitive: bool,
        count_offset: u64,
    ) -> VanitySearcher {
        let match_type = match (prefix, suffix) {
            (Some(p), Some(s)) => {
                let prefix_str = if case_insensitive {
                    p.to_lowercase()
                } else {
                    p
                };
                let suffix_str = if case_insensitive {
                    s.to_lowercase()
                } else {
                    s
                };
                MatchType::Both(prefix_str, suffix_str)
            }
            (Some(p), None) => {
                let prefix_str = if case_insensitive {
                    p.to_lowercase()
                } else {
                    p
                };
                MatchType::Prefix(prefix_str)
            }
            (None, Some(s)) => {
                let suffix_str = if case_insensitive {
                    s.to_lowercase()
                } else {
                    s
                };
                MatchType::Suffix(suffix_str)
            }
            (None, None) => MatchType::Prefix(String::new()), // Default to empty prefix
        };

        VanitySearcher {
            base_pubkey: base_pubkey.try_into().unwrap(),
            owner_pubkey: owner_pubkey.try_into().unwrap(),
            match_type,
            case_insensitive,
            count: 0,
            count_offset,
            should_exit: false,
        }
    }

    #[wasm_bindgen]
    pub fn search_batch(&mut self, batch_size: u32) -> Option<VanityResult> {
        let mut base_sha = Sha256::new();

        for _ in 0..batch_size {
            if self.should_exit {
                return None;
            }

            let seed = generate_seed_from_counter(self.count + self.count_offset);

            base_sha.update(&self.base_pubkey); // Cheaper to rehash that clone the hasher
            base_sha.update(seed);
            base_sha.update(&self.owner_pubkey);
            let pubkey_bytes: [u8; 32] = base_sha.finalize_reset().into();

            let mut encoded_buf = [0u8; five8::BASE58_ENCODED_32_MAX_LEN];
            let encoded_len = five8::encode_32(&pubkey_bytes, &mut encoded_buf);
            let pubkey = std::str::from_utf8(&encoded_buf[..encoded_len as usize]).unwrap();

            let out_str_target_check = maybe_bs58_aware_lowercase(pubkey, self.case_insensitive);

            self.count += 1;

            // Check prefix/suffix matching using enum
            let matches = match &self.match_type {
                MatchType::Prefix(prefix) => out_str_target_check.starts_with(prefix),
                MatchType::Suffix(suffix) => out_str_target_check.ends_with(suffix),
                MatchType::Both(prefix, suffix) => {
                    out_str_target_check.starts_with(prefix)
                        && out_str_target_check.ends_with(suffix)
                }
            };

            if matches {
                return Some(VanityResult::new(
                    pubkey.to_string(),
                    String::from_utf8_lossy(&seed).to_string(),
                    self.count,
                ));
            }
        }

        None
    }

    #[wasm_bindgen]
    pub fn stop(&mut self) {
        self.should_exit = true;
    }

    #[wasm_bindgen(getter)]
    pub fn attempts(&self) -> u64 {
        self.count
    }
}

#[wasm_bindgen]
pub struct VanityResult {
    address: String,
    seed: String,
    attempts: u64,
}

#[wasm_bindgen]
impl VanityResult {
    #[wasm_bindgen(constructor)]
    pub fn new(address: String, seed: String, attempts: u64) -> VanityResult {
        VanityResult {
            address,
            seed,
            attempts,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn address(&self) -> String {
        self.address.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn seed(&self) -> String {
        self.seed.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn attempts(&self) -> u64 {
        self.attempts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_batch() {
        let mut vanity_searcher =
            VanitySearcher::new(&[1, 2, 3], &[4, 5, 6], Some("AAA".into()), None, false, 0);

        loop {
            if let Some(vanity_result) = vanity_searcher.search_batch(1000) {
                println!("{}", vanity_result.address);
                break;
            }
        }
    }
}
