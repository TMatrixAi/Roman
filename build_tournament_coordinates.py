import csv
import os
import sys
import time

import requests


API_KEY = os.getenv("GEOAPIFY_API_KEY")
BATCH_URL = "https://api.geoapify.com/v1/batch/geocode/search"
OUTPUT_FILE = "tournament_coordinates.csv"

TOURNAMENTS = [
    {
        "tournament_name": "Wimbledon",
        "address": "All England Lawn Tennis and Croquet Club, Wimbledon, London, United Kingdom",
    },
    {
        "tournament_name": "Roland-Garros",
        "address": "Stade Roland Garros, Paris, France",
    },
    {
        "tournament_name": "US Open",
        "address": "USTA Billie Jean King National Tennis Center, Queens, New York, USA",
    },
    {
        "tournament_name": "Australian Open",
        "address": "Melbourne Park, Melbourne, Australia",
    },
    {
        "tournament_name": "Indian Wells",
        "address": "Indian Wells Tennis Garden, Indian Wells, California, USA",
    },
    {
        "tournament_name": "Miami Open",
        "address": "Hard Rock Stadium, Miami Gardens, Florida, USA",
    },
    {
        "tournament_name": "Madrid Open",
        "address": "Caja Magica, Madrid, Spain",
    },
    {
        "tournament_name": "Italian Open",
        "address": "Foro Italico, Rome, Italy",
    },
    {
        "tournament_name": "Canadian Open Toronto",
        "address": "Sobeys Stadium, Toronto, Ontario, Canada",
    },
    {
        "tournament_name": "Canadian Open Montreal",
        "address": "IGA Stadium, Montreal, Quebec, Canada",
    },
    {
        "tournament_name": "Cincinnati Open",
        "address": "Lindner Family Tennis Center, Mason, Ohio, USA",
    },
]


def submit_batch():
    addresses = [item["address"] for item in TOURNAMENTS]

    response = requests.post(
        BATCH_URL,
        params={
            "apiKey": API_KEY,
            "limit": 1,
            "lang": "en",
        },
        json=addresses,
        timeout=60,
    )

    if response.status_code not in (200, 202):
        raise RuntimeError(
            f"Batch submission failed: {response.status_code}\n{response.text}"
        )

    data = response.json()
    job_id = data.get("id")

    if not job_id:
        raise RuntimeError(f"No job ID returned: {data}")

    print(f"Batch job submitted. Job ID: {job_id}")
    return job_id


def wait_for_results(job_id):
    while True:
        response = requests.get(
            BATCH_URL,
            params={
                "id": job_id,
                "apiKey": API_KEY,
            },
            timeout=60,
        )

        if response.status_code == 202:
            print("Still processing. Waiting 60 seconds...")
            time.sleep(60)
            continue

        if response.status_code == 200:
            print("Batch job completed.")
            return response.json()

        raise RuntimeError(
            f"Could not retrieve results: {response.status_code}\n{response.text}"
        )


def get_first_result(item):
    if not isinstance(item, dict):
        return None

    if "result" in item:
        item = item["result"]

    if isinstance(item.get("features"), list) and item["features"]:
        properties = item["features"][0].get("properties", {})
        return properties

    if isinstance(item.get("results"), list) and item["results"]:
        return item["results"][0]

    if "lat" in item and "lon" in item:
        return item

    return None


def save_csv(batch_results):
    if isinstance(batch_results, dict):
        results = batch_results.get("results", [])
    else:
        results = batch_results

    rows = []

    for index, tournament in enumerate(TOURNAMENTS):
        result_item = results[index] if index < len(results) else {}
        result = get_first_result(result_item)

        if result:
            latitude = result.get("lat", "")
            longitude = result.get("lon", "")
            formatted_address = result.get("formatted", "")
            status = "matched"
        else:
            latitude = ""
            longitude = ""
            formatted_address = ""
            status = "not_found"

        rows.append(
            {
                "tournament_name": tournament["tournament_name"],
                "search_address": tournament["address"],
                "latitude": latitude,
                "longitude": longitude,
                "formatted_address": formatted_address,
                "status": status,
            }
        )

    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "tournament_name",
                "search_address",
                "latitude",
                "longitude",
                "formatted_address",
                "status",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Saved coordinates to {OUTPUT_FILE}")


def main():
    if not API_KEY:
        print(
            "ERROR: GEOAPIFY_API_KEY was not found.\n"
            "Put your Geoapify key in Replit Secrets using the exact name:\n"
            "GEOAPIFY_API_KEY"
        )
        sys.exit(1)

    try:
        job_id = submit_batch()
        batch_results = wait_for_results(job_id)
        save_csv(batch_results)
    except requests.RequestException as error:
        print(f"Network error: {error}")
        sys.exit(1)
    except Exception as error:
        print(f"ERROR: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()