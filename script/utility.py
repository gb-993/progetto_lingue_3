#!/usr/bin/env python3
# coding: utf-8
#
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Copyright (C) 2023 Federico Motta    <federico.motta@unimore.it>
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

from argparse import (
    ArgumentDefaultsHelpFormatter,
    ArgumentParser,
    RawDescriptionHelpFormatter,
)
from collections import defaultdict
from datetime import datetime
from logging import (
    DEBUG,
    Formatter,
    INFO,
    StreamHandler,
    WARNING,
    basicConfig,
    debug,
    getLogger,
    info,
)
from matplotlib import colormaps, colors
from os import remove
from os.path import realpath
from sklearn.metrics import pairwise_distances
from tempfile import NamedTemporaryFile
import numpy as np
from script_jaccard import jaccard as ceolin_jaccard


ALLOWED_EXTENSIONS = defaultdict(
    lambda: "to_pickle",
    dict(
        csv="to_csv",
        npy="to_numpy",
        pkl="to_pickle",
        txt="to_string",
        xlsx="to_excel",
    ),
)
MISSING_VALUES = ("?", "0", "-/+", "+/-", "0+")
INCH_TO_MILLIMETERS = 25.4
A4_LANDSCAPE_PAGE_SIZE_INCHES = tuple(
    map(lambda mm: round(mm / INCH_TO_MILLIMETERS, 6), (297, 210))
)  # sqrt(2) aspect ratio

A4_PORTRAIT_PAGE_SIZE_INCHES = tuple(reversed(A4_LANDSCAPE_PAGE_SIZE_INCHES))


class HelpFormatter(
    ArgumentDefaultsHelpFormatter,
    RawDescriptionHelpFormatter,
):
    pass


def get_cli_parser(docstring, file_path):
    ret = ArgumentParser(
        **reflective_docs(docstring, file_path), formatter_class=HelpFormatter
    )
    ret.__error = ret.error  # this is awful
    ret.error = lambda msg: ret.__error(  # I am sorry..
        f"{msg}\n\n"
        + "\n".join(
            ret.format_help().split("\n")[
                ret.format_help().split("\n").index("options:") :  # noqa: E203
            ]
        )
    )
    return ret


def hamming(l1, l2, *args, **kwargs):
    return pairwise_distances([l1], [l2], metric="hamming")


def initialize_logging(suffix_filename, verbosity):
    r"""
    If you want to monitor the logs on GNU/Linux:

        unset LESSOPEN;                          \
        while sleep 1; do                        \
            watch -n1                            \
            'ls -v1 /tmp/*debug*                 \
            | tail -n1                           \
            | xargs tail -n 512                  \
            | egrep -v "^\s*$"                   \
            | cut -c-$(( $(tput cols) - 8 ))     \
            | uniq                               \
            | tail -n $(( $LINES - 5 ))          \
            '                                    \
            ; ls -v1 /tmp/*debug*                \
            | tail -n1                           \
            | xargs less -n +G -S                \
            ;                                    \
        done

    While macOS uses /var/folders/rw/*/*/*debug.log instead of /tmp/*debug*
    """
    logfile = NamedTemporaryFile(
        prefix=datetime.now().strftime("%Y_%m_%d__%H_%M_%S____"),
        suffix="____"
        + str(
            suffix_filename.strip("_")
            + str(".txt" if "." not in suffix_filename else "")
        ),
        delete=False,
    )
    basicConfig(
        filename=logfile.name,
        force=True,
        format="\t".join(
            (
                "[{levelname: ^9s}| {module}+L{lineno} | PID-{process}]",
                "{message}",
            )
        ),
        level=DEBUG,  # use always the most verbose level for log file
        style="{",
    )
    root_logger = getLogger()
    stderr_handle = StreamHandler()
    stderr_handle.setLevel(
        dict(enumerate([WARNING, INFO])).get(verbosity, DEBUG),
    )
    stderr_handle.setFormatter(Formatter("{levelname}: {message}", style="{"))
    root_logger.addHandler(stderr_handle)

    # make foreign modules quiet in logfile
    for module_name in ("matplotlib", "numexpr"):
        getLogger(module_name).setLevel(WARNING)

    info("Temporary file with debugging log will be available here:")
    info(f"{' ' * 4}{logfile.name}")
    debug(f"{'~' * 120}")
    debug("")
    debug("Logging initialized and temporary file created")
    debug("")


def jaccard(l1, l2, *args, **kwargs):
    """
    Returns (1 / ceolin_jaccard) because ceolin's jaccard function
    returns distance instead of similarity
    """
    l1 = ["+" if el > 0 else "-" for el in l1]
    l2 = ["+" if el > 0 else "-" for el in l2]

    dist = ceolin_jaccard(l1, l2)
    return 1 if dist == 0 else dist


def link_color_func(k):
    return colors.to_hex(colormaps.get_cmap("jet")(hash(k)))


def reflective_docs(docstring, file_path, sep="Usage:"):
    docstring = docstring.split(sep if sep in docstring else None)[0].strip()
    gpl_license = "\n".join(
        line.lstrip("#")[1:]
        for line in open(realpath(file_path)).read().split("\n")
        if line.startswith("#")
    )
    for year, authors in {
        2025: ("federico.motta", "lorenzo.carletti"),
        2024: ("federico.motta", "lorenzo.carletti"),
        2023: ("andrea.serafini", "matteo.vanzini"),
    }.items():
        if str(year) in gpl_license:
            for author in authors:
                assert f"{author}@unimore.it" in gpl_license, str(
                    f"Please add {author}@unimore.it "
                    f"to {file_path} copyright notice"
                )
    gpl_license = gpl_license.split("\n")[
        next(
            i
            for i, line in enumerate(gpl_license.split("\n"))
            if "copyright" in line.lower()
        ) : next(  # noqa: E203
            j
            for j, line in enumerate(gpl_license.split("\n"))
            if "gnu.org/license" in line.lower()
        )
        + 1
    ]
    return dict(description=docstring, epilog="\n".join(gpl_license))


def serialize(df, file_obj):
    debug(f"{file_obj.name=}")
    ext = file_obj.name.split(".")[-1]
    if ext not in list(ALLOWED_EXTENSIONS.keys()) + ["<stdout>"]:
        remove(file_obj.name)  # avoid creating empty files
        raise Exception(f"Unrecognized output file extension: {ext}")
    fun = getattr(df, ALLOWED_EXTENSIONS[ext])

    assert file_obj.mode == "wb", f"{file_obj.name=}, {file_obj.mode=}"
    if ext in ("csv", "txt"):
        with open(file_obj.name, "w") as f:
            fun(f)
    elif ext == "npy":
        np.save(file_obj, fun())
    else:
        fun(file_obj)
