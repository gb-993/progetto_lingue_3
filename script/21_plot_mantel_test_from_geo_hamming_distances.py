#!/usr/bin/env python3
# coding: utf-8
#
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Copyright (C) 2026 Federico Motta    <federico.motta@unimore.it>
#                    Lorenzo  Carletti <lorenzo.carletti@unimore.it>
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
Plot a Mantel test from a hamming and geographic distance matrices

Usage:
     python3 src/21_plot_mantel_test_from_geo_hamming_distances.py \
         -G datasets/distances/km_distances_among_ALL.xlsx         \
         -H datasets/distances/hamming/hamming_distances_ALL.txt   \
         --gcd                                                     \
         -o mantel_test_ALL_GCD_result.png
"""

import argparse
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from skbio.stats.distance import mantel

# Global variable for to select a subset of languages/dialects
SUBSET_LABELS = list()


def run_mantel_and_plot(
    geo_file,
    hamming_file,
    output_image,
    geo_sheet,
    dist_name,
    width,
    height,
):
    # 1. Load the matrices
    try:
        # Read the geographic distance matrix from the Excel file
        df_geo = pd.read_excel(geo_file, sheet_name=geo_sheet, index_col=0)

        # Read the Hamming distance matrix from the space-separated text file
        df_hamming = pd.read_csv(hamming_file, sep=r"\s+", index_col=0)
    except Exception as e:
        raise SystemExit(f"Error loading files: {e}")

    # 2. Align the matrices
    # It is critical that both matrices have the exact same labels in
    # the exact same order
    common_labels = df_geo.index.intersection(df_hamming.index)

    # Filter the common labels if a subset is provided via the global variable
    global SUBSET_LABELS
    if SUBSET_LABELS:
        common_labels = common_labels.intersection(SUBSET_LABELS)

    if len(common_labels) < 3:
        raise SystemExit(
            "Error: Not enough common labels found between "
            "the two matrices to perform a Mantel test."
        )

    df_geo = df_geo.loc[common_labels, common_labels]
    df_hamming = df_hamming.loc[common_labels, common_labels]

    # Convert to numpy arrays for calculation
    geo_matrix = df_geo.values
    hamming_matrix = df_hamming.values

    # 3. Run the Mantel Test
    # Using 999 permutations is standard practice for calculating the p-value
    r_stat, p_value, n_permutations = mantel(
        geo_matrix, hamming_matrix, method="pearson", permutations=999
    )

    # 4. Extract pairwise distances for plotting
    # We only plot the upper triangle of the matrices to avoid
    # duplicating pairs and plotting the 0.0 diagonals
    row_idx, col_idx = np.triu_indices(len(common_labels), k=1)
    geo_condensed = geo_matrix[row_idx, col_idx]
    hamming_condensed = hamming_matrix[row_idx, col_idx]

    # 5. Plotting
    plt.figure(figsize=(width / 2.54, height / 2.54))
    plt.scatter(
        geo_condensed,
        hamming_condensed,
        alpha=0.7,
        edgecolors="k",
        color="dodgerblue",
    )

    # Add a linear trendline
    m, b = np.polyfit(geo_condensed, hamming_condensed, 1)
    plt.plot(
        geo_condensed,
        m * geo_condensed + b,
        color="red",
        linestyle="--",
        alpha=0.8,
    )

    # Formatting the plot dynamically based on the distance used
    plt.title(f"Mantel Test: {dist_name} vs. Hamming Distance", fontsize=14)
    plt.xlabel(f"{dist_name} Distance (km)", fontsize=12)
    plt.ylabel("Hamming Distance", fontsize=12)

    # Annotate the plot with the statistical results
    stats_text = f"Mantel $r$: {r_stat:.4f}\n$p$-value: {p_value:.4f}"
    plt.annotate(
        stats_text,
        xy=(0.05, 0.95),
        xycoords="axes fraction",
        verticalalignment="top",
        fontsize=11,
        bbox=dict(
            boxstyle="round,pad=0.5",
            facecolor="white",
            alpha=0.9,
            edgecolor="gray",
        ),
    )

    plt.grid(True, linestyle="--", alpha=0.5)
    plt.tight_layout()
    plt.savefig(output_image, dpi=300)

    print("--- Mantel Test Complete ---")
    print(f"Distance Metric:    {dist_name}")
    print(f"Mantel r-statistic: {r_stat:.4f}")
    print(f"p-value:            {p_value:.4f}")
    print(f"Plot saved to:      {output_image}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=str(
            "Run a Mantel test comparing Geographic "
            "and Hamming distance matrices."  #
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    # Required Input/Output arguments
    parser.add_argument(
        "-G",
        "--geo",
        required=True,
        help="Path to the geographic distance Excel file",
    )
    parser.add_argument(
        "-H",
        "--hamming",
        required=True,
        help="Path to the Hamming distance text file",
    )
    parser.add_argument(
        "-o",
        "--output",
        required=True,
        help="Path to save the output plot image (Allowed extensions: "
        + str(
            ", ".join(
                sorted(
                    "png,jpg,tiff,pdf,svg,eps,ps".split(","),
                    key=str.lower,
                )
            )
        )
        + ")",
    )

    # Optional subset labels
    parser.add_argument(
        "-L",
        "--label",
        nargs="+",
        help="Subset of language/dialect lables (default: all available)",
        default=list(),
    )

    # Mutually exclusive group for distance metric
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--gcd",
        action="store_true",
        help="Use Great Circle Distance",
    )
    group.add_argument(
        "--fly",
        action="store_true",
        help="Use Crow Flies (Geodesic) Distance",
    )

    # Plot dimensions
    parser.add_argument(
        "--width",
        type=float,
        default=8 * 2.54,
        help="Output plot width in cm",
    )
    parser.add_argument(
        "--height",
        type=float,
        default=6 * 2.54,
        help="Output plot height in cm",
    )
    args = parser.parse_args()

    # Update global variable
    SUBSET_LABELS = args.label

    if args.gcd:
        dist_name = "Great Circle"
    elif args.fly:
        dist_name = "Crow Flies"

    run_mantel_and_plot(
        geo_file=args.geo,
        hamming_file=args.hamming,
        output_image=args.output,
        geo_sheet=f"{dist_name} Distance (km)",
        dist_name=dist_name,
        width=args.width,
        height=args.height,
    )
