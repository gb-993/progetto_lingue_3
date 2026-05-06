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
"""
Build a dendrogram by running UPGMA over some language parameters

UPGMA (Unweighted Pair Group Method with Arithmetic mean) is a
simple agglomerative (bottom-up) hierarchical clustering method

Usage:
     mkdir -p out_plot && python3 src/01_plot_clusters.py -i out_preprocess -o out_plot | grep -i record | grep -o '\\[.*\\]' | sort -V |uniq -c
"""
import numpy as np
import pandas as pd

# from matplotlib import colormaps
# from matplotlib import colors
from logging import debug  # , info, warning, critical
from matplotlib import pyplot as plt
from os.path import basename, join as join_path
from scipy.spatial import distance
from scipy.cluster.hierarchy import dendrogram
from sklearn.cluster import AgglomerativeClustering
from utility import get_cli_parser, initialize_logging
import os


DPI = 300
PLT_TITLE = "Hierarchical Clustering Dendrogram\n(UPGMA method)"
CHOSEN_DISTANCE = "hamming"


def are_same_cluster(
    source_dialect,
    dest_dialect,
    groupings,
    k,
    no_groups_index,
):
    try:
        src_color = groupings[k][source_dialect]
        dst_color = groupings[k][dest_dialect]
        return (src_color != no_groups_index) and (src_color == dst_color)
    except Exception as e:
        debug(f"TODO: check what kind of exception this can be...\n{e!s}")
    return False


def create_clusters(clusters_dict, all_languages, valid_languages):
    clusterless_list = list()
    result_last = dict()
    for language in sorted(
        set(all_languages) & set(valid_languages),
        key=str.lower,
    ):
        sorted_list = sorted(set(clusters_dict[language]))
        if len(sorted_list) > 1:
            result_last[sorted_list[0]] = sorted_list
        else:
            clusterless_list += [language]
    return clusterless_list, result_last


def get_output_clusters(
    clusters_dict,
    parsed_args,
    all_languages,
    valid_languages,
):
    clusterless_list, result_last = create_clusters(
        clusters_dict, all_languages, valid_languages
    )
    out_string = ""
    for key in result_last.keys():
        out_string += " ".join(result_last[key])
        out_string += "\n"

    if parsed_args.print_clusterless and len(clusterless_list) > 0:
        out_string += "C:\n"
        out_string += " ".join(clusterless_list)
        out_string += "\n"
    return out_string


def plot_dendrogram(
    model,
    plot_title,
    plot_x_label,
    out_file_name,
    color_threshold_coeff,
    **kwargs,
):
    """Create linkage matrix and then plot the dendrogram"""

    counts = np.zeros(model.children_.shape[0])
    n_samples = len(model.labels_)
    for i, merge in enumerate(model.children_):
        current_count = 0
        for child_idx in merge:
            if child_idx < n_samples:
                current_count += 1  # leaf node
            else:
                current_count += counts[child_idx - n_samples]
        counts[i] = current_count

    linkage_matrix = np.column_stack(
        [model.children_, model.distances_, counts]
    ).astype(float)

    plt.clf()
    plt.cla()
    plt.title(plot_title)
    plt.xlabel(plot_x_label)

    color_threshold = None
    if color_threshold_coeff is not None:
        color_threshold = color_threshold_coeff * max(linkage_matrix[:, 2])
    out_dendogram = dendrogram(
        linkage_matrix, color_threshold=color_threshold, **kwargs
    )

    plt.savefig(out_file_name, dpi=DPI)
    return out_dendogram


def read_and_make_dendrogram(
    input_file_name,
    out_file_name,
    plot_title,
    plot_x_label,
    input_sheet_name="Sheet1",
):
    df = pd.read_excel(input_file_name, sheet_name=input_sheet_name)
    df = df.set_index(df.columns[0]).astype(int)
    df = df.sort_index()
    df.columns = df.columns.astype(str)

    model = AgglomerativeClustering(
        linkage="average",
        metric=CHOSEN_DISTANCE,
        distance_threshold=0,
        n_clusters=None,
    )

    model.fit(df)

    languages = list(df.index)
    dendrogram = plot_dendrogram(
        model,
        plot_title,
        plot_x_label,
        out_file_name,
        0.56,
        labels=languages,
        # color_threshold=0.7,
        # link_color_func=lambda k: colors.to_hex(
        #     colormaps.get_cmap("jet")(hash(k))
        # ),
    )

    distances = dict()
    for language in languages:
        distances[language] = distance.cdist(
            df.values,
            np.array([df.loc[language]]),
            metric=CHOSEN_DISTANCE,
        )
    return [distances, dendrogram]


parser = get_cli_parser(__doc__, __file__)
parser.add_argument(
    "-i",
    "--input_directory",
    default="./out_preprocess",
    help="Directory containing preprocessed (with 00_preprocess) files",
    metavar="str",
    required=True,
    type=str,
)
parser.add_argument(
    "-o",
    "--output_directory",
    default="./out_plot",
    help="Directory that will contain results ()",
    metavar="str",
    required=True,
    type=str,
)
parser.add_argument(
    "-p",
    "--print_clusterless",
    default=False,
    help="Print clusterless dialects",
    action="store_true",
)
parser.add_argument(
    "-v",
    "--verbose",
    action="count",
    default=0,
    dest="verbosity",
)

parsed_args = parser.parse_args()

initialize_logging(
    basename(__file__).removesuffix(".py").rstrip("_") + "__debug.log",
    parsed_args.verbosity,
)

input_file_list = sorted(
    os.listdir(parsed_args.input_directory), key=lambda v: repr(v).lower()
)
num_plots = len(input_file_list)


results = list()
groupings = list()
for i in range(num_plots):
    results += [
        read_and_make_dendrogram(
            join_path(parsed_args.input_directory, input_file_list[i]),
            join_path(
                parsed_args.output_directory,
                input_file_list[i].replace(".xlsx", ".svg"),
            ),
            PLT_TITLE,
            input_file_list[i].rstrip(".xlsx").replace("_", " "),
        )
    ]

    groupings += [dict()]
    for j in range(len(results[i][1]["ivl"])):
        color = results[i][1]["leaves_color_list"][j]
        dialect = results[i][1]["ivl"][j]
        groupings[i][dialect] = color
languages = list(groupings[0].keys())

reported = set()
total_num_matches = dict()
for i in range(1, num_plots):
    languages_own = list()
    for lang in sorted(
        set(groupings[i].keys()) - set(languages) - set(reported),
        key=str.lower,
    ):
        print(f"{lang:<8} not in all tables!")
        languages.append(lang)
        reported.add(lang)

    for lang in sorted(
        set(languages) - set(groupings[i].keys()) - set(reported),
        key=str.lower,
    ):
        print(f"{lang:<8} not in all tables!")
        reported.add(lang)

languages = sorted(languages, key=str.lower)
shared_languages = sorted(set(languages) - set(reported), key=str.lower)
clusters = [{lang: list() for lang in languages} for _ in range(num_plots + 1)]

no_groups_index = "C0"
for source_dialect in languages:
    num_matches = list()
    for dest_dialect in languages:
        num_single_matches = 0
        for k in range(num_plots):
            if are_same_cluster(
                source_dialect, dest_dialect, groupings, k, no_groups_index
            ):
                num_single_matches += 1
        num_matches += [num_single_matches]
        clusters[num_single_matches][source_dialect] += [dest_dialect]
    total_num_matches[source_dialect] = num_matches

final_result = pd.DataFrame.from_dict(
    total_num_matches, orient="index", columns=languages
)

final_result.to_excel(
    join_path(parsed_args.output_directory, "plot_clusters_result.xlsx")
)

out_string = get_output_clusters(
    clusters[num_plots], parsed_args, languages, shared_languages
)

with open(join_path(parsed_args.output_directory, "clusters.txt"), "w") as f:
    f.write(f"{num_plots!s} Tables Fused\n{out_string}")

for k in range(num_plots):
    clusters = {lang: list() for lang in languages}
    for source_dialect in languages:
        for dest_dialect in languages:
            if are_same_cluster(
                source_dialect, dest_dialect, groupings, k, no_groups_index
            ):
                clusters[source_dialect] += [dest_dialect]

    out_string = get_output_clusters(
        clusters, parsed_args, languages, groupings[k].keys()
    )

    with open(
        join_path(parsed_args.output_directory, f"clusters_{k}.txt"),
        "w",
    ) as f:
        f.write(
            "\n".join(
                (
                    input_file_list[k].rstrip(".xlsx").replace("_", " "),
                    out_string,
                )
            )
        )
