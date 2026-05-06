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
Build a distance matrix from a list of (latitude, longitude) coordinates

Usage:
     python3 src/11_latitude_longitude_to_distance_matrix.py               \
         -i datasets/geolocation/99_dialects_lat_long_geolocation_ALL.xlsx \
         -o datasets/distances/km_distances_among_ALL.xlsx
"""

import argparse
import pandas as pd
from geopy.distance import geodesic, great_circle

# Global variable for target columns
TARGET_COLS = ["Label", "Latitude", "Longitude"]


def generate_distance_matrices(input_file, output_file, fly=True, gcd=True):
    try:
        # Using a callable to usecols to strip whitespace before
        # matching against TARGET_COLS
        df = pd.read_excel(
            input_file, usecols=lambda c: c.strip() in TARGET_COLS
        ).rename(
            columns=lambda c: c.strip()  # actual whitespace strip
        )
    except Exception as e:
        raise SystemExit(f"Error reading the input file: {e}")

    # Check if all required columns are actually present after loading
    missing_cols = [col for col in TARGET_COLS if col not in df.columns]
    if missing_cols:
        raise SystemExit(
            f"Error: Input file is missing required columns: {missing_cols}"
        )

    # Drop any rows with missing coordinates or labels just in case
    df = df.dropna(subset=TARGET_COLS)

    # Extract the labels to serve as both row and column indices
    labels = df["Label"].tolist()

    # Initialize empty DataFrames conditionally based on flags
    df_crow_flies = pd.DataFrame(index=labels, columns=labels, dtype=float)
    df_great_circle = pd.DataFrame(index=labels, columns=labels, dtype=float)

    # Calculate the all-to-all distances
    for i, row1 in df.iterrows():
        from_coor = (row1["Latitude"], row1["Longitude"])
        from_lang = row1["Label"]

        for j, row2 in df.iterrows():
            to_coor = (row2["Latitude"], row2["Longitude"])
            to_lang = row2["Label"]

            if from_lang == to_lang:
                df_crow_flies.at[from_lang, to_lang] = 0.0
                df_great_circle.at[from_lang, to_lang] = 0.0
            else:
                # Geodesic distance on WGS-84 ellipsoid, aka as the crow flies
                df_crow_flies.at[from_lang, to_lang] = round(
                    geodesic(from_coor, to_coor).km, 3
                )
                # Great Circle distance (Spherical model)
                df_great_circle.at[from_lang, to_lang] = round(
                    great_circle(from_coor, to_coor).km, 3
                )

    # Write the matrices into a single output Excel file across sheets
    # depending on flags
    with pd.ExcelWriter(output_file, engine="openpyxl") as writer:
        if fly:
            df_crow_flies.to_excel(
                writer,
                sheet_name="Crow Flies Distance (km)",
            )
        if gcd:
            df_great_circle.to_excel(
                writer,
                sheet_name="Great Circle Distance (km)",
            )
    print(f"Success! Distance matrices have been saved to '{output_file}'.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate distance matrices from Excel file coordinates."
    )
    parser.add_argument(
        "-i",
        "--input",
        required=True,
        help="Path to the input Excel file",
    )
    parser.add_argument(
        "-o",
        "--output",
        required=True,
        help="Path for the output Excel file",
    )
    parser.add_argument(
        "--gcd",
        action="store_true",
        help="Generate Great Circle distances.",
    )
    parser.add_argument(
        "--fly",
        action="store_true",
        help="Generate Crow Flies (Geodesic) distances.",
    )
    args = parser.parse_args()

    gcd, fly = args.gcd, args.fly
    if not args.gcd and not args.fly:  # if neither flag is set
        gcd, fly = True, True  # default to both
    generate_distance_matrices(args.input, args.output, fly, gcd)
