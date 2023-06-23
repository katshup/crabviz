use {
    super::Language,
    crate::{
        lsp_types::{DocumentSymbol, SymbolKind},
    },
};

pub(crate) struct C;

impl Language for C {
    fn filter_symbol(&self, symbol: &DocumentSymbol) -> bool {
        match symbol.kind {
            SymbolKind::Constant
            | SymbolKind::Field
            | SymbolKind::EnumMember => false,
            _ => true,
        }
    }
}
