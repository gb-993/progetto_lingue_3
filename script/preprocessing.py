#!/usr/bin/env python3
# coding: utf-8
#
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Copyright (C) 2024 Federico Motta    <federico.motta@unimore.it>
#                    Lorenzo  Carletti <lorenzo.carletti@unimore.it>
#
#               2023 Federico Motta    <federico.motta@unimore.it>
#                    Lorenzo  Carletti <lorenzo.carletti@unimore.it>
#                    Matteo   Vanzini  <matteo.vanzini@unimore.it>
#                    Andrea   Serafini <andrea.serafini@unimore.it>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
r"""
Preprocess raw input datasets to have research-ready datasets

Usage:
    export DATASET_DIR="datasets";            \
    export PREPROCESSED_DIR="out_preprocess"; \
    for f in                                  \
                Pellegrini_1970.xlsx          \
                Pellegrini_1977.xlsx          \
                SSWL.xlsx                     \
                TableA_2025SI.xlsx            \
        ; do                                  \
        python3 src/preprocessing.py          \
            -i "${DATASET_DIR}/${f}"          \
            -o "${PREPROCESSED_DIR}/${f}"     \
            --impute-nan 5;                   \
    done
"""

from argparse import FileType
from logging import debug, info, warning, critical
from os.path import basename
from string import ascii_letters, digits, punctuation
from tempfile import NamedTemporaryFile
from utility import (
    ALLOWED_EXTENSIONS,
    get_cli_parser,
    initialize_logging,
    MISSING_VALUES,
    serialize,
    jaccard as hamming,
)
import numpy as np
import pandas as pd
from sklearn.impute import KNNImputer

__DEFAULT = dict(
    drop_nan=False,
    flatten_multi_index=["NUM Pellegrini", "Isogloss", "Code", "Label"],
    impute_nan=0,
    input=None,
    maintain_original_values=False,
    output=None,
    pivot_cell="TP",
    pivot_cell_type="record",
    sheet=0,
    sort_rows=True,
    sort_columns=True,
    verbose=0,
)


def is_column_excel_in_list(elem, list_to_check, pivot_cell):
    if elem == pivot_cell:
        return False
    if elem in list_to_check:
        return True
    # Accomodate how pandas loads duplicate column names
    to_check_elem = elem.split(".")[0].strip()
    if to_check_elem == pivot_cell:
        return False
    return to_check_elem in list_to_check


def clean_excel_file(**kwargs):
    for k, v in kwargs.items():
        assert k in __DEFAULT, str(
            "Unrecognized parameter"
            f" {clean_excel_file.__name__}( ... {k}={v!r} ... )"
            f"\nPlease use only the available ones:\n\t"
            + "\n\t".join(sorted(__DEFAULT.keys(), key=str.lower))
        )
    for k, v in __DEFAULT.items():
        if k not in kwargs:
            kwargs[k] = v
    assert kwargs["input"] is not None, "Please provide an excel file"
    if kwargs["output"] is None:
        kwargs["output"] = NamedTemporaryFile(
            mode="wb",
            prefix="".join(
                c if c in f"{ascii_letters}{digits}" else "_"
                for c in "__".join(
                    map(
                        str,
                        (
                            "file",
                            basename(kwargs["input"].name),
                            "",
                            "sheet",
                            kwargs["sheet"],
                            "",
                        ),
                    )
                )
            ),
            suffix=".xlsx",
        )
    debug(f"\n\n\nCalling {clean_excel_file.__name__}(")
    for k, v in kwargs.items():
        debug(f"{k:<16} = {v!r}")
    debug(")\n\n\n")

    # Discover available sheets
    info(f"Reading excel file {kwargs['input'].name!s}")
    sheets = set(pd.read_excel(kwargs["input"], sheet_name=None).keys())
    debug(f"Available sheets: {repr(sorted(sheets, key=str.lower))[1:-1]}.")
    assert kwargs["sheet"] in sheets | set(
        range(len(sheets))
    ), f"Required --sheet={kwargs['sheet']!r} not found!"

    excel_kwargs = dict(
        sheet_name=kwargs["sheet"],
        true_values=["+", "Yes", "yes", " +"],
        false_values=["-", "No", "no", " -"],
        na_values=set(MISSING_VALUES).difference({"+/-", "-/+"}),
    )
    if kwargs["maintain_original_values"]:
        debug(
            "Ignoring the following excel_kwargs, since we don't "
            "want to replace anyone of them because of "
            "-m/--maintain-original-values"
        )
        for k in set(excel_kwargs.keys()):
            if k.endswith("_values"):
                debug(f"{k:>16}={excel_kwargs.pop(k)!r}")
    df = pd.read_excel(kwargs["input"], **excel_kwargs)

    # sometimes we need to treat the very first row as a row instead
    # of a table header because otherwise the following code cannot
    # find the pivot cell
    # df = df.transpose().reset_index(drop=False).transpose()
    debug(
        "Hypothetical columns:\n\t"
        + "\n\t".join(
            [
                f"{row_i=}\t"
                + ", ".join(
                    map(
                        lambda s: f"{str(s)[:9]}"
                        + str("..." if len(str(s)) > 9 else ""),
                        df.iloc[row_i, :].astype("string").to_list(),
                    )
                )
                for row_i in range(min(5, len(df.index)))
            ]
        )
    )
    debug(
        "Hypothetical index:\n"
        + pd.concat(
            [
                pd.DataFrame(np.vstack([df.columns, df]))
                .iloc[:, col_j]
                .rename(f"{col_j=}")
                .astype("string")
                .str.slice_replace(32, repl="...")
                for col_j in range(min(5, len(df.columns)))
            ],
            axis=1,
        ).to_string()
    )

    # Discover the actual start of the structured table
    expected_columns = None
    excel_kwargs["index_col"] = 0
    excel_kwargs["skiprows"] = 0
    if df.reset_index(drop=True).duplicated(keep=False).any():
        excel_kwargs["skipfooter"] = [
            i
            for i, flag in df.reset_index(
                drop=True,
            )
            .duplicated()
            .items()
            if flag
        ]
        debug(f"{excel_kwargs['skipfooter']=}")
    try:
        for col_j in range(len(df.columns)):
            if str(df.columns[col_j]).strip() != kwargs["pivot_cell"]:
                continue
            debug(f"first column")
            excel_kwargs["index_col"] = list(range(col_j))
            excel_kwargs["skiprows"] = 0
            expected_columns = df.columns[col_j:].to_list()
            raise StopIteration(
                "Pivot matched cell "
                + repr(
                    ":".join(
                        map(
                            str,
                            (
                                chr(ord("A") + col_j),
                                0,
                            ),
                        )
                    )
                )
            )
        for col_j in range(len(df.columns)):
            for row_i in range(len(df.index)):
                if str(df.iloc[row_i, col_j]).strip() != kwargs["pivot_cell"]:
                    continue
                debug(f"{row_i=}, {col_j=}")
                excel_kwargs["index_col"] = list(range(col_j))
                excel_kwargs["skiprows"] = row_i + 1
                expected_columns = df.iloc[
                    row_i, list(range(col_j, len(df.columns)))
                ].to_list()
                raise StopIteration(
                    "Pivot matched cell "
                    + repr(
                        ":".join(
                            map(
                                str,
                                (
                                    chr(ord("A") + col_j),
                                    row_i + 1,
                                ),
                            )
                        )
                    )
                )
    except StopIteration as e:
        info(str(e))  # empty rows are skipped, thus the row may be smaller!

        # because of the above transpose/reset_index/transpose we
        # added without really wanting it a fake row at the very top
        # excel_kwargs["skiprows"] -= 1
        if "skipfooter" in excel_kwargs:
            # TODO improve autodetection and removal of duplicate footer/right index

            excel_kwargs["skipfooter"] = set(  #
                excel_kwargs.pop("skipfooter")
            ).difference(set(range(excel_kwargs["skiprows"])))
            if not excel_kwargs["skipfooter"]:
                excel_kwargs.pop("skipfooter")  # empty set
            elif excel_kwargs["skipfooter"] == set(
                range(min(excel_kwargs["skipfooter"]), len(df.index))
            ):
                excel_kwargs["skipfooter"] = len(df.index) - min(
                    excel_kwargs["skipfooter"],
                )
            else:
                warning(
                    "Could not selectively skip non-adjacent rows "
                    + repr(tuple(excel_kwargs.pop("skipfooter")))
                )
        debug(f"{excel_kwargs['index_col']=}")
        if not excel_kwargs["index_col"]:
            excel_kwargs["index_col"] = None
        new_expected_columns = []
        for elem in expected_columns:
            if not is_column_excel_in_list(
                elem, kwargs["flatten_multi_index"], kwargs["pivot_cell"]
            ):
                new_expected_columns += [elem]
        expected_columns = new_expected_columns
        debug(f"{expected_columns=}")
        debug(excel_kwargs)
    else:
        critical(
            f"Could not find pivot {kwargs['pivot_cell']!r} in sheet "
            f"{kwargs['sheet']!r} of {kwargs['input'].name!r}"
        )
        raise SystemExit(1)

    # Final painless (hopefully) parsing of the table
    df = pd.read_excel(kwargs["input"], **excel_kwargs)
    debug(
        "Dataset contains the following values: "
        + repr(sorted(set(df.values.flatten()), key=str))[1:-1]
        + ".\n\n"
    )
    if expected_columns is not None and set(df.columns).difference(
        set(expected_columns)
    ):
        warning(
            "Could not find the following expected columns:\n\t-"
            + "\n\t-".join(
                sorted(
                    set(df.columns) - set(expected_columns),
                    key=str.lower,
                )
            )
        )

    # Avoid using multi-index, let's arbitrarily choose the left most one
    if len(df.index.names) > 1:
        warning(
            "Rows have multiple indexes: "
            + repr(list(df.index.names))[1:-1]
            + " !!!\n"
        )
        for col in kwargs["flatten_multi_index"]:
            if col in df.index.names:
                df = df.reset_index(
                    list(set(df.index.names) - set([col])),
                    drop=True,
                )
                break
        else:
            df = df.reset_index(
                list(range(len(df.index.names) - 1)), drop=True
            )
        info(f"Column {df.index.name!r} will be used instead")

    base_columns_list = df.columns.to_list()
    for elem in base_columns_list:
        if is_column_excel_in_list(
            elem, kwargs["flatten_multi_index"], kwargs["pivot_cell"]
        ):
            df = df.drop(columns=elem)
    # Drop duplicated headers (again)
    drop_rows = [
        i
        for i, row in df.reset_index(drop=True).transpose().items()
        if df.shape[1] == row.size and row.eq(df.columns).all()
    ]
    if drop_rows:
        warning(
            "Dropping rows duplicating the header:\n"
            + df.reset_index().iloc[drop_rows, :].to_string()
        )
        df = df.iloc[sorted(set(range(df.shape[0])) - set(drop_rows)), :]
    if kwargs["sort_rows"]:
        df = (
            df.reset_index(names="index")
            .assign(
                sort_by=lambda _df: pd.Series(
                    [
                        (
                            str(
                                int(
                                    _df.loc[i, "index"]
                                    .split("=")[0]
                                    .strip(ascii_letters + punctuation)
                                )
                            ).rjust(2, "0")
                            if "=" in str(_df.loc[i, "index"])
                            else str("0" if flag else "")
                        )
                        for i, flag in _df["index"]
                        .astype(str)
                        .str.len()
                        .eq(1)
                        .items()
                    ],
                    dtype="string",
                ).str.cat(_df["index"].astype("string"), join="right")
            )
            .sort_values("sort_by")
            .drop(  # comment this line to debug index sorting
                columns="sort_by"
            )
            .set_index("index")
            .rename_axis(df.index.name, axis=0)
        )
    if kwargs["sort_columns"]:
        df = df.loc[:, sorted(df.columns, key=str.lower)]
    debug(f"Post rows/columns sorting dataset\n{df.to_string()}\n{'~' * 80}")

    if not kwargs["maintain_original_values"]:
        # Somehow input 03 and 04 fail automagically converting some
        # of the true/false values; maybe because of the duplicated
        # header, which however we already dropped at this point
        df = df.replace({tv: True for tv in excel_kwargs["true_values"]})
        df = df.replace({fv: False for fv in excel_kwargs["false_values"]})

        # we chose with Andrea Sgarro that +/- and -/+ were treatable
        # as 0.5 in a fuzzy way
        df = df.replace({"+/-": 0.5, "-/+": 0.5})

    pivot_axis = kwargs.pop("pivot_cell_type")
    debug(f"Pre-transposition dataset\n{df.to_string()}\n{'-' * 80}")
    if pivot_axis in ("record", "row"):
        debug(f"Transposing dataset because of {pivot_axis=}")
        df = df.transpose()

    if not kwargs["maintain_original_values"]:
        if kwargs["drop_nan"]:
            debug("Dropping columns/features with missing data")
            df = df.dropna(axis=1)
        if kwargs["impute_nan"] < 0:
            critical("The number of neighbors must be > 0")
            raise SystemExit(2)
        elif kwargs["impute_nan"] > 0:  # if k==0 this is skipped
            debug(
                "Imputing missing values with "
                f"{kwargs['impute_nan']} neighbors"
            )
            df = df.rename(columns=str)

            # keep_empty_features=True => if a feature is full NaN, it is
            # set to False metric can also be set to "nan_euclidean"
            imputer = KNNImputer(
                n_neighbors=kwargs["impute_nan"],
                weights="distance",
                metric=hamming,
                keep_empty_features=True,
            )
            imputed_array = imputer.fit_transform(df)

            if "1970" in kwargs["input"].name:
                df = pd.DataFrame(
                    imputed_array,
                    columns=df.columns,
                    index=df.index,
                ).astype("float")
            else:
                df = pd.DataFrame(
                    imputed_array,
                    columns=df.columns,
                    index=df.index,
                ).ge(0.5)

    debug(f"final dataframe\n{df.to_string()}\n\n{df.shape=}")

    if not kwargs["maintain_original_values"] and set(df.values.flatten()) != {
        True,
        False,
    }:
        warning(
            "Dataset contains the following non-boolean values: "
            + repr(
                sorted(
                    set(df.values.flatten()) - {True, False},
                    key=str,
                )
            )[1:-1]
            + "."
        )

    df = df.rename(index={"PCM": "PCa", "TE": "Ter"})

    try:
        serialize(df, kwargs["output"])
    except Exception as e:
        critical(str(e))
        raise SystemExit(3)
    debug(f"End of function {clean_excel_file.__name__}()\n\n")
    return df


if __name__ == "__main__":
    parser = get_cli_parser(__doc__, __file__)

    parser.add_argument(
        "-i",
        "--input",
        default=__DEFAULT["input"],
        help="Excel input file containing the DataFrame to parse",
        metavar="xlsx",
        required=True,
        type=FileType("rb"),
    )
    parser.add_argument(
        "-s",
        "--sheet",
        default=__DEFAULT["sheet"],
        help="Sheet number or name to read from unput file",
        metavar="int|str",
    )
    parser.add_argument(
        "-p",
        "--pivot-cell",  # dest="pivot",
        default=__DEFAULT["pivot_cell"],
        help="Content of the most upper-left cell in the table",
        type=str,
    )
    parser.add_argument(
        "--pivot-cell-type",  # dest="pivot_axis",
        choices=("record", "feature", "row", "col"),
        default=__DEFAULT["pivot_cell_type"],
        help="If 'row' or 'record' the matrix will be transposed",
    )
    parser.add_argument(
        "-f",
        "--flatten-multi-index",  # dest="flat_index",
        default=__DEFAULT["flatten_multi_index"],
        help="Preferred order of columns guiding the multi-index substitution",
        metavar="col",
        nargs="+",
        type=str,
    )
    parser.add_argument(
        "-m",
        "--maintain-original-values",
        action="store_true",
        default=__DEFAULT["maintain_original_values"],
        help="Keep +, -, +/-, 0, ? values",
    )
    parser.add_argument(
        "-0",
        "--drop-nan",
        action="store_true",
        default=__DEFAULT["drop_nan"],
        help="Drop columns/features with missing/null/NaN values",
    )
    parser.add_argument(
        "-k",
        "--impute-nan",  # dest="n_neighbors",
        default=__DEFAULT["impute_nan"],
        help="Impute missing data with K nearest neighbors",
        metavar="int",
        type=int,
    )
    parser.add_argument(
        "-o",
        "--output",
        default=__DEFAULT["output"],
        help="Output file (allowed extensions: "
        + ", ".join(sorted(ALLOWED_EXTENSIONS.keys()))
        + ";\nuse - to serialize in pickle format to <stdout>)",
        metavar="file",
        required=True,
        type=FileType("wb"),
    )
    parser.add_argument(
        "-v",
        "--verbose",  # dest="verbosity",
        action="count",
        default=__DEFAULT["verbose"],
    )
    parsed_args = parser.parse_args()  # parse CLI arguments

    initialize_logging(
        basename(__file__).removesuffix(".py").rstrip("_") + "__debug.log",
        parsed_args.verbose,
    )
    debug(f"{parsed_args=}")

    clean_excel_file(**vars(parsed_args))
