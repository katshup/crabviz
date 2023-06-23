mod go;
mod java;
mod rust;
mod c;

use {
    self::{go::Go, java::Java, rust::Rust, c::C},
    crate::{
        generator::FileOutline,
        graph::{Cell, Style, TableNode},
        lsp_types::{DocumentSymbol, SymbolKind},
    },
};

pub(crate) trait Language {
    fn file_repr(&self, file: &FileOutline) -> TableNode {
        let sections = file
            .symbols
            .iter()
            .filter(|symbol| self.filter_symbol(symbol))
            .map(|symbol| self.symbol_repr(file.id, symbol))
            .collect();

        TableNode {
            id: file.id.to_string(),
            title: file.path.file_name().unwrap().to_str().unwrap().to_string(),
            sections,
        }
    }

    fn symbol_repr(&self, file_id: u32, symbol: &DocumentSymbol) -> Cell {
        let styles = self.symbol_style(symbol);

        let children = symbol
            .children
            .iter()
            .filter(|symbol| self.filter_symbol(symbol))
            .map(|symbol| self.symbol_repr(file_id, symbol))
            .collect();

        let port = format!(
            "{}_{}",
            symbol.selection_range.start.line, symbol.selection_range.start.character
        )
        .to_string();

        Cell {
            port: port.clone(),
            id: format!("{}:{}", file_id, port),
            styles,
            title: symbol.name.clone(),
            children,
        }
    }

    fn filter_symbol(&self, symbol: &DocumentSymbol) -> bool {
        match symbol.kind {
            SymbolKind::Constant
            | SymbolKind::Variable
            | SymbolKind::Field
            | SymbolKind::EnumMember => false,
            _ => true,
        }
    }

    fn symbol_style(&self, symbol: &DocumentSymbol) -> Vec<Style> {
        match symbol.kind {
            SymbolKind::Function | SymbolKind::Method | SymbolKind::Constructor => {
                vec![Style::CssClass("fn".to_string()), Style::Rounded]
            }
            SymbolKind::Interface => {
                vec![
                    Style::CssClass("interface".to_string()),
                    Style::Border(0),
                    Style::Rounded,
                ]
            }
            _ => vec![],
        }
    }

    // fn handle_unrecognized_functions(&self, funcs: Vec<&DocumentSymbol>);
}

pub struct DefaultLang;

impl Language for DefaultLang {}

pub(crate) fn language_handler(ext: &str) -> Box<dyn Language + Sync + Send> {
    match ext {
        "go" => Box::new(Go),
        "java" => Box::new(Java),
        "rs" => Box::new(Rust),
        "c"
        | "cpp"
        | "h"
        | "hpp" => Box::new(C),
        _ => Box::new(DefaultLang {}),
    }
}
