use std::iter;

use crate::file_structure::{Module, RItem};

const MIN_WIDTH: u32 = 230;

fn ritem_cell(item: &RItem) -> String {
    format!(
        r#"<TR><TD PORT="{id}">{name}</TD></TR>"#,
        id = item.id(),
        name = item.ident,
    )
}

fn ritem_table(item: &RItem) -> String {
    static EMPTY: &Vec<RItem> = &vec![];
    let cells = iter::once(item)
        .chain(item.children.as_ref().unwrap_or(EMPTY).iter())
        .map(|m| ritem_cell(m))
        .collect::<Vec<_>>()
        .join("\n        ");

    format!(
        r#"
        <TR><TD>
        <TABLE BORDER="1" CELLBORDER="0" ROWS="*">
        {}
        </TABLE>
        </TD></TR>
        "#,
        cells,
    )
}

fn module_node(m: &Module) -> String {
    let groups = m
        .items
        .iter()
        .map(|ritem| ritem_table(ritem))
        .collect::<Vec<_>>()
        .join("\n");

    let node_header = format!(
        r#"<TR><TD WIDTH="{width}" BORDER="0"><FONT POINT-SIZE="12">{title}</FONT></TD></TR>"#,
        width = MIN_WIDTH,
        title = m.path.file_name().unwrap().to_str().unwrap(),
    );

    format!(
        r#"
    "{}" [label=<
        <TABLE BORDER="0" CELLBORDER="0">
        {}
        {}
        <TR><TD BORDER="0"></TD></TR>
        </TABLE>
    >]
        "#,
        m.file_id, node_header, groups,
    )
}

pub(crate) fn modules_graph(modules: &Vec<Module>) -> String {
    format!(
        r#"
digraph graphviz {{
    graph [
        rankdir = "LR"
        ranksep = 2.0
    ];
    node [
        fontsize = "16"
        fontname = "helvetica, open-sans"
        shape = "plaintext"
        style = "rounded, filled"
    ];

    {}
}}
        "#,
        modules
            .iter()
            .map(|m| module_node(m))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}
